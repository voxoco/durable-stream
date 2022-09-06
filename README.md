# Durable Stream :earth_americas:

A 0 dependency messaging server that uses [Durable Objects](https://developers.cloudflare.com/workers/learning/using-durable-objects) to provide a persistent **subject** based message stream to/from clients over Websockets.

## Why?

There are plenty of **clustered** messaging solutions like [Redis](https://redis.io/), [RabbitMQ](https://www.rabbitmq.com/), and [NATS](https://nats.io). But what if you want a **serverless** solution? This project is an attempt to provide just that using [Cloudflare Workers](https://workers.cloudflare.com/) that models itself after [NATS Jetstream](https://docs.nats.io/nats-concepts/jetstream) (except a more opinionated and simplified implementation). We are also testing this out as a possible MySQL query replication query stream as it provides a global uniqueness for any number of our MySQL proxy clients running the [Durable Stream Client](https://github.com/voxoco/durable-stream-client).

## How?

The server is built using [Cloudflare Workers](https://workers.cloudflare.com/), [Durable Objects](https://developers.cloudflare.com/workers/learning/using-durable-objects), and [R2](https://developers.cloudflare.com/r2/). The [Durable Stream Client](https://github.com/voxoco/durable-stream-client) uses [Websocket-Node](https://github.com/theturtle32/WebSocket-Node).

For every new message received by a client, the server will increment the sequence number and store the message using the storage API. The server will then broadcast the message to all connected clients (in an eventually consistent manner). When a new client comes online, by default the server will send all messages in the stream but the client can also request a specific sequence number to start from.

## What?

The server acts as a message broker for clients. Any number of clients can connect to the server and the server will broadcast any messages received to all connected clients. Clients must ack messages.

The server also allows the clients to send commands (e.g. `getServerInfo`, `subscribe`, `unsubscribe`, `deleteMessages`, `getState`, `putState`) and the server will respond to the client with the result of the command in a request/reply manner.

The server also provides a full*ish* API for `GET`, `POST`, and `DELETE` requests for R2 (storing files).

* Supports request/reply semantics
* Requires clients to ack messages broadcasted to the stream subject
* Supports multiple stream subjects (based on the url path)
* Always aware of the current sequence number for the stream subject even if the server restarts/deploys
* Prefers frequent checkpoints to keep storage costs down and prevent unnecessary message syncing when new clients come online
* Simple to use
* Extremely lightweight
* Works with Miniflare (for local dev)

## Usage

### Local dev

Create a `.env` file with the following:

```bash
API_KEY=<your_test_api_key>
```

```bash
npm install
npm run dev
```

Run the [Durable Stream Client](https://github.com/voxoco/durable-stream-client) specifying the `host` as `ws://localhost:8787`, and `secure` as `false`.

### Deploy

Before deploying, you will need a paid workers subscription. You also need to create an R2 bucket and add the bucket name to `bucket_name` in the `wrangler.toml` file. Then run:

```bash
npm run deploy
```

After deploying, add an `API_KEY` environment variable to the worker. This will be used to authenticate clients.

## TODO

- [ ] Do not send messages to clients that have not acked the previous message (or some other mechanism to prevent clients from getting messages out of order). This will require a `waitingOperations` queue for each client.
- [ ] `waitingOperations` needs some love. It could cause a memory leak if the client never acks a message. We should probably have a max size for the queue and a max time to wait for an ack.
