export default async (req, func) => {
  try {
    return await func();
  } catch (err) {

    if (req.headers.get("Upgrade") !== "websocket") return new Response(err.stack, {status: 500});

    // Annoyingly, if we return an HTTP error in response to a WebSocket request, Chrome devtools
    // won't show us the response body! So... let's send a WebSocket response with an error
    // frame instead.
    let pair = new WebSocketPair();
    pair[1].accept();
    pair[1].send(JSON.stringify({error: err.stack}));
    pair[1].close(1011, "Uncaught exception during session setup");
    return new Response(null, { status: 101, webSocket: pair[0] });
  }
}