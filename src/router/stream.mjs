export default async (req, env) => {
  
  const url = new URL(req.url);
  const path = url.pathname.slice(1).split('/');

  // Make sure this is a GET request
  if (req.method !== 'GET') return new Response('Not Found', {status: 404});

  // Request should be `/stream/<stream-name>`
  if (!path[1]) return new Response('Error', {status: 500});

  // Get the stream object id from the path
  const id = env.durableStream.idFromName(path[1]);
  // Get the durable object stub for this stream subject
  const obj = env.durableStream.get(id);

  // Add `/websocket` to the path to get the websocket endpoint
  const wsUrl = new URL(req.url);
  wsUrl.pathname = '/websocket';

  console.log(`New connection for stream ${path[1]}`);

  // Send the request to the object
  return obj.fetch(wsUrl, req);
}