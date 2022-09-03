import handleErrors from "./handleErrors.mjs";
import router from "./router/index.mjs";

// Worker
export default {
  async fetch(req, env) {
    return await handleErrors(req, async () => {
      // We have received an HTTP request. Parse the URL and route the request
      return await router(req, env);
    })
  }
}

// Durable Object
export class DurableStream {
  constructor(controller, env) {
    // `controller.storage` provides access to our durable storage, kv, etc...
    this.storage = controller.storage;

    // Initialize the sequence number from storage
    this.sequence = -1;
      
    // `env` is our environment bindings
    this.env = env;

    // We will put the websocket objects for each client, along with metadata, into `sessions`
    this.sessions = {};

    // For promised messages
    this.waitingOperations = {};

    // For message ids
    const rand = Math.random();
    this.sMsgId = rand;

    // Object to hold arbitrary data (like some state)
    this.state = {};
  }

  // Initialize the sequence number from storage
  async initSequence() {
    const lastKey = await this.storage.list({limit: 1, reverse: true, prefix: '1'});
    this.sequence = lastKey.keys().next().value ? parseInt(lastKey.keys().next().value) : 100000000000;
  }

  // Initialize the state object from storage
  async initState() {
    const state = await this.storage.get('state');
    this.state = state ? JSON.parse(state) : {lock: false, sequence: 100000000000};
    await this.storage.put('state', JSON.stringify(this.state));
  }

  // The system will call fetch() whenever an HTTP request is sent to this object
  async fetch(req) {
    return await handleErrors(req, async () => {
      const url = new URL(req.url);

      // Could be the first time we are running, so initialize the sequence number
      if (this.sequence === -1) await this.initSequence();

      if (!Object.keys(this.state).length) await this.initState();

      switch (url.pathname) {
        case "/websocket":
          // This request is to `/stream/<stream-name>/websocket`. We will upgrade it to a websocket
          if (req.headers.get("Upgrade") !== "websocket") return new Response("Expected websocket", {status: 400});

          // Get the ip for fun
          const ip = req.headers.get('CF-Connecting-IP');

          // Create the websocket pair
          const pair = new WebSocketPair();

          // We're going to take pair[1] as our end, and return pair[0] to the client.
          await this.handleSession(pair[1], ip);

          // Now we return the other end of the pair to the client
          return new Response(null, { status: 101, webSocket: pair[0] });

        default:
          return new Response("Not found", { status: 404 });
      }
    })
  }

  // Handle promise sessions
  async handleSession(ws, ip) {
    ws.accept();

    // Add the websocket to our sessions list
    const sid = Math.random().toString(16).slice(2);
    this.sessions[sid] = {ws, ip, hasListener: false, sid};

    // On "close", remove the WebSocket from the sessions list and broadcast
    const closeHandler = async () => {
      console.log(`Session closed: ${sid}`);
      delete this.sessions[sid];
    }

    ws.addEventListener("close", closeHandler);
    ws.addEventListener("error", closeHandler);

    // Listen for messages
    ws.addEventListener('message', async (msg) => {
      await this.handleMessage(msg, sid);
    })
  }

  async handleMessage(msg, sid) {
    let json = JSON.parse(msg.data);

    if (!json.data) return;

    // This must be a message from us to the client that is waiting for a response
    if (json.sMsgId) {
      this.waitingOperations[json.sMsgId].resolveMe(json);
      delete this.waitingOperations[json.sMsgId];
      return;
    }

    if (!json.cMsgId) return;

    // This is a message from a client that needs a response
    json.ip = this.sessions[sid].ip;
    json.sequence = this.sequence;

    // First check for any commands
    if (json.data?.cmd) {
      switch(json.data.cmd) {
        case 'getStreamInfo':
          this.sessions[sid].ws.send(json);
          return;
        case 'subscribe':
          this.sessions[sid].ws.send(JSON.stringify(json));
          await this.subscribe(json.data.startSequence, sid);
          this.sessions[sid].hasListener = true;
          return;
        case 'unsubscribe':
          this.sessions[sid].hasListener = false;
          this.sessions[sid].ws.send(JSON.stringify(json));
          return;
        case 'deleteMessages':
          await this.delete(json.data.sequence);
          this.sessions[sid].ws.send(JSON.stringify(json));
          return;
        case 'getState':
          json.state = this.state;
          this.sessions[sid].ws.send(JSON.stringify(json));
          return;
        case 'putState':
          this.state = json.data.state;
          await this.storage.put('state', JSON.stringify(this.state));
          this.sessions[sid].ws.send(JSON.stringify(json));
          return;
        default:
          console.log('Unknown command', json.data.cmd);
      }
    }

    // Message from a client that needs to be broadcast
    const newSequence = this.sequence + 1;
    json.sequence = newSequence;
    await this.storage.put(`${newSequence}`, JSON.stringify(json));

    // Now increment the sequence number
    this.sequence = newSequence;

    // Now that the message is stored, reply to the client
    this.sessions[sid].ws.send(JSON.stringify(json));

    // Broadcast the message to all clients
    await this.broadcast(json);
  }

  async publish(msg, sid) {
    return new Promise((resolve) => {
      this.sMsgId++;
      msg.pub = 1;
      this.waitingOperations[this.sMsgId] = { resolveMe: resolve, ...msg, sMsgId: this.sMsgId };
      this.sessions[sid].ws.send(JSON.stringify({...msg, sMsgId: this.sMsgId}));
    })
  }

  // Broadcast a message to all clients.
  async broadcast(msg) {
    // Get list of sessions that have a listener
    const sessions = Object.values(this.sessions).filter(s => s.hasListener);

    // Early return if there are no sessions with a listener
    if (!sessions.length) return;

    console.log(`Broadcasting to ${sessions.length} sessions`);

    // Send the message to each session
    let promises = [];
    for (const sid of sessions) promises.push(this.publish(msg, sid));

    // Wait for all the messages to be sent
    await Promise.all(promises);
  }

  // Handle subscriptions
  async subscribe(start, sid) {
    if (start <= 0) start = 0;

    // If the startSequence is greater than or equal to this.sequence then there are no messages to send
    if (start >= this.sequence) {
      console.log(`No backlog of messages to send to ${sid}`);
      return;
    }

    // Take the start position and retrieve all messages after it
    const end = `${this.sequence + 1}`;
    // Since storage api returns the map in lexicographic order, we need all the messages...
    let msgs = await this.storage.list({start, end, prefix: '1'});

    if (![...msgs.keys()].length) return;

    // We have messages to send, so send them
    console.log(`Sending ${[...msgs.keys()].length} messages to consumer`);
    for (const [key, value] of msgs) if (value !== '') await this.publish(JSON.parse(value), sid);

    // Now that the consumer is caught up to `end` run this again to send any messages that were missed
    if (parseInt(end) >= this.sequence) return;

    console.log(`Consumer is still behind by ${this.sequence - parseInt(end)} messages`);
    start = parseInt(end);
    await this.subscribe(start, sid);
  }

  // Handle delete from storage
  async delete(sequence) {
    if (sequence <= 0) return;

    // Delete the messages from storage up to `sequence`
    let msgs = await this.storage.list({start: 0, end: sequence + 1, prefix: '1'});

    if (![...msgs.keys()].length) return;

    // Delete the messages
    console.log(`Deleting ${[...msgs.keys()].length} messages from storage`);
    for (const [key, value] of msgs) {
      if (parseInt(key) >= this.sequence) {
        console.log(`Attempt to delete messages > or = current sequence`);
        await this.storage.put(key, '');
        continue;
      }
      await this.storage.delete(key);
    }
  }
}