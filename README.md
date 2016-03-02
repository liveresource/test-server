# LiveResource Test Server

This is a simple server written in Node.js that implements the various transport combinations of the LiveResource protocol. There is a public instance available at [http://test.liveresource.org/](http://test.liveresource.org/).

The server exposes a single resource, `/test`, which has a value containing the current unix timestamp.

Example request:
```http
GET /test HTTP/1.1
Host: test.liveresource.org
```

Example response:
```http
HTTP/1.1 200 OK
Etag: "1456905833"
X-Poll-Interval: 10
Link: </test?after=1456905833>; rel=changes
Link: </test>; rel=value-wait
Link: </test?after=1456905833>; rel=changes-wait
Link: </test>; rel=value-stream
Link: </test?changes>; rel=changes-stream
Link: </test?hints>; rel=hint-stream
Content-Type: application/json

{"time": 1456905833}
```

Query parameters can be used to control which features are advertised and how the server should behave:

* `types={types}`: Comma-separated list of Link rel types to support, e.g. `changes,value-wait` (default all).
* `no_poll_header`: If present, don't set `X-Poll-Interval`.
* `reliable`: If present, advertise reliable versions of transports.
* `timeout={x}`: Tell the server to close the connection after `x` seconds. Use to simulate disconnects.

The `/test` resource supports listening for changes. It uses a custom format for changes that looks like this:

```json
{"time:change": "+10"}
```

The above changes payload would mean the time has increased by 10 seconds since the last update. The reason for the odd custom format here is to demonstrate that LiveResource is agnostic to the format.

For unreliable transports (the default), the server deliberately skips pushing data sometimes, to simulate lossy delivery.
