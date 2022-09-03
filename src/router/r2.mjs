export default async (req, env) => {
  const url = new URL(req.url);
  // Remove the first part of the path `/r2/`
  const key = url.pathname.split('/').slice(2).join('/');

  console.log(`${req.method} object '${key}' ${req.url}`);

  // Handle HEAD requests
  if (req.method === 'HEAD') {
    if (key === '') return new Response(undefined, {status: 400});

    const object = await env.bucket.head(key);
    if (!object) return await objectNotFound(key);

    const headers = new Headers();
    object.writeHttpMetadata(headers);
    headers.set('etag', object.httpEtag);
    
    return new Response(null, {headers});
  }
  
  // Handle GET requests
  if (req.method === 'GET') {
    if (key === '') {
      const options = {
        prefix: url.searchParams.get('prefix') ?? undefined,
        delimiter: url.searchParams.get('delimiter') ?? undefined,
        cursor: url.searchParams.get('cursor') ?? undefined,
        include: ['customMetadata', 'httpMetadata'],
      }
      console.log(JSON.stringify(options));
  
      const listing = await env.bucket.list(options);
      return new Response(JSON.stringify(listing), {headers: {'content-type': 'application/json; charset=UTF-8'}});
    }

    const range = await parseRange(req.headers.get('range'));
    const object = await env.bucket.get(key, {range, onlyIf: req.headers});

    if (!object) return await objectNotFound(key);

    const headers = new Headers();
    object.writeHttpMetadata(headers);
    headers.set('etag', object.httpEtag);
    if (range) { headers.set("content-range", `bytes ${range.offset}-${range.end}/${object.size}`) }
    const status = object.body ? (range ? 206 : 200) : 304;

    return new Response(object.body, {headers, status});
  }

  // Handle POST requests
  if (req.method === 'POST') {
    const object = await env.bucket.put(key, req.body, {httpMetadata: req.headers})

    return new Response(`Put ${key} successfully!`, { headers: { 'etag': object.httpEtag } });
  }

  // Handle DELETE requests
  if (req.method === 'DELETE') {
    await env.bucket.delete(key);
    return new Response();
  }

  return new Response('Unsupported method', {status: 400});
}

const parseRange = async (encoded) => {
  if (encoded === null) return;

  const parts = encoded.split("bytes=")[1]?.split("-") ?? []
  if (parts.length !== 2) throw new Error('Not supported to skip specifying the beginning/ending byte at this time');

  return { offset: Number(parts[0]), end: Number(parts[1]), length: Number(parts[1]) + 1 - Number(parts[0]) }
}

const objectNotFound = async (key) => {
  return new Response(`<html><body>R2 object "<b>${key}</b>" not found</body></html>`, {
    status: 404,
    headers: {'content-type': 'text/html; charset=UTF-8'}
  })
}