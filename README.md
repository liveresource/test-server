# LiveResource Test Server

This is a simple server written in Node.js that implements the various transport combinations of the LiveResource protocol. There is a public instance available at [http://test.liveresource.org/](http://test.liveresource.org/).

The server exposes two resources:

* `/test`: value contains the current time as a unix timestamp. It changes every 3 seconds.
* `/test2`: like `/test`, but an hour ahead. It changes every 10 seconds.

Example request:
```http
GET /test HTTP/1.1
Host: test.liveresource.org
```

Example response:
```http
HTTP/1.1 200 OK
ETag: "1456905833"
X-Poll-Interval: 10
Link: </test?after=1456905833>; rel=changes
Link: </test>; rel=value-wait
Link: </test?after=1456905833>; rel=changes-wait
Link: </test>; rel=value-stream
Link: </test?changes>; rel=changes-stream
Link: </test?hints>; rel=hint-stream
Link: </multi>; rel=multiplex-wait
Link: </ws>; rel=multiplex-socket
Content-Type: application/json

{"time": 1456905833}
```

Query parameters can be used to control which features are advertised and how the server should behave:

* `types={types}`: Comma-separated list of Link rel types to support, e.g. `changes,value-wait` (default all).
* `no_poll_header`: If present, don't set `X-Poll-Interval`.
* `no_previous`: If present, don't provide `Previous-ETag` in stream/socket pushes.
* `no_share_multiplex`: If present, don't offer the same `multiplex-wait` or `multiplex-socket` links across different resources. Intead offer unique endpoints per-resource.
* `reliable`: If present, advertise reliable versions of transports.
* `timeout={x}`: Tell the server to close the connection after `x` seconds. Use to simulate disconnects.

The `/test` resource supports listening for changes. It uses a custom format for changes that looks like this:

```json
{"time:change": "+10"}
```

The above changes payload would mean the time has increased by 10 seconds since the last update. The reason for the odd custom format here is to demonstrate that LiveResource is agnostic to the format.

For unreliable transports (the default), the server deliberately skips pushing data sometimes, to simulate lossy delivery.

## Limiting available transports

The `types` parameter can be used to tell the server which transports to offer.

Example request:
```http
HEAD /test?types=value-wait HTTP/1.1
Host: test.liveresource.org
```

Example response:
```http
HTTP/1.1 200 OK
ETag: "1456905833"
X-Poll-Interval: 10
Link: </test>; rel=value-wait
Content-Type: application/json
```

## Transport examples

### Plain-polling

The resources on the test server support plain polling. Obviously this is the case for the resource value, but polling of changes is also possible with the `changes` link.

The server sends the `X-Poll-Interval` response header in order to control the rate the client polls. If you want to test client behavior in the absence of this header, set the `no_poll_header` query parameter.

Plain-poll for value:
```http
GET /test HTTP/1.1
Host: test.liveresource.org
```

Response:
```http
HTTP/1.1 200 OK
ETag: "1456905833"
X-Poll-Interval: 10
Link: </test?after=1456905833>; rel=changes
Content-Type: application/json

{"time": 1456905833}
```

Plain-poll for changes:
```http
GET /test?after=1456905833 HTTP/1.1
Host: test.liveresource.org
```

Response:
```http
HTTP/1.1 200 OK
X-Poll-Interval: 10
Link: </test?after=1456905843>; rel=changes
Content-Type: application/json

{"time:change": "+10"}
```

Plain-poll without server-specified poll interval:
```http
GET /test?no_poll_interval HTTP/1.1
Host: test.liveresource.org
```

Response:
```http
HTTP/1.1 200 OK
ETag: "1456905833"
Link: </test?after=1456905833>; rel=changes
Content-Type: application/json

{"time": 1456905833}
```

### Long-polling

The resources on the test server support long-polling.

Long-poll for value:
```http
GET /test HTTP/1.1
Host: test.liveresource.org
If-None-Match: "1456905833"
Wait: 55
```

Response if resource unchanged after wait time expires:
```http
HTTP/1.1 304 Not Modified
ETag: "1456905833"
Content-Type: application/json
```

Response if resource changes while waiting:
```http
HTTP/1.1 200 OK
ETag: "1456905843"
Content-Type: application/json

{"time": 1456905843}
```

Long-poll for changes:
```http
GET /test?after=1456905833 HTTP/1.1
Host: test.liveresource.org
Wait: 55
```

Response if resource unchanged after wait time expires:
```http
HTTP/1.1 200 OK
Content-Type: application/json

{"time:change": "+0"}
```

Response if resource changes while waiting:
```http
HTTP/1.1 200 OK
Link: </test?after=1456905843>; rel=changes-wait
Content-Type: application/json

{"time:change": "+10"}
```

### Multiplex long-polling

It is possible to long-poll multiple resources in a single request. There are 3 `multiplex-wait` endpoints:

* `/multi`: supports requests for `/test` or `/test2`.
* `/test/multi`: supports requests for `/test` only.
* `/test2/multi`: supports requests for `/test2` only.

The `no_share_multiplex` option can be used to tell the server to not advertise the same multiplex link for different resources. This can be useful to force clients to use different multiplex endpoints at the same time, for testing.

Long-poll for value of one resource and changes of another:
```http
GET /multi HTTP/1.1
Host: test.liveresource.org
Uri: </test>; If-None-Match="1456905833", </test2&after=1456909433>
Wait: 55
```

*Note: While it ought to be legal in the LiveResource protocol to send multiple `Uri` headers, the test server requires all URIs to be concatenated into a single `Uri` header, separated by commas. This is due to a limitation in Express.*

Response if neither resource changes in time:
```http
HTTP/1.1 200 OK
Content-Type: application/json

{
  "/test": {
    "code": 304,
    "headers": {
      "ETag": "\"1456905833\""
    },
    "body": ""
  },
  "/test2": {
    "code": 200,
    "headers": {
      "Link":"</test2?after=1456909433>; rel=changes"
    },
    "body": "{\"time:change\": \"+0\"}"
  }
}
```

Response if at least one of the resources has changed:
```http
HTTP/1.1 200 OK
Content-Type: application/json

{
  "/test": {
    "code": 200,
    "headers": {
      "ETag": "\"1456905843\""
    },
    "body": "{\"time\": 1456905843}"
  }
}
```

### Streaming

The resources on the test server support streaming.

Requesting value stream:
```http
GET /test HTTP/1.1
Host: test.liveresource.org
Accept: text/event-stream
```

Initial response:
```http
HTTP/1.1 200 OK
Content-Type: text/event-stream
Transfer-Encoding: chunked

event: open
data:

```

Streamed value (wrapped for readability):
```http
event: update
data: {"Content-Type":"application/json",
    "ETag":"\"1456905843\"",
    "Previous-ETag":"\"1456905833\""}
data: {"time":1456905843}

```

If this were a changes stream instead of a value stream, updates would look like this (wrapped for readability):
```http
event: update
data: {"Content-Type":"application/json",
    "Link":"</test?after=1456905843>; rel=changes",
    "Changes-Id":"1456905843",
    "Previous-Changes-Id":"1456905833"}
data: {"time:change":"+10"}

```

The `Previous-ETag` and `Previous-Changes-Id` fields inside the updates can be used to detect missing data. The client can recover value data by polling the resource normally. The client can recover changes data by polling the last received `changes` link. To test client behavior in the absence of `Previous-ETag`, set the `no_previous` query parameter in the request.

### Reliable streaming

The server supports reliable streaming. To use it, pass the `reliable` query parameter. This parameter will also cause the server to advertise links with `mode=reliable`.

Querying for headers with reliability enabled:
```http
HEAD /test?reliable HTTP/1.1
Host: test.liveresource.org
```

Response:
```http
HTTP/1.1 200 OK
ETag: "1456905833"
Link: </test?reliable>; rel=value-stream; mode=reliable
Link: </test?reliable&after=1456905833>; rel=changes-stream; mode=reliable
Content-Type: application/json
```

Requesting reliable value stream:
```http
GET /test?reliable HTTP/1.1
Host: test.liveresource.org
Accept: text/event-stream
```

Initial response (wrapped for readability):
```http
HTTP/1.1 200 OK
Content-Type: text/event-stream
Transfer-Encoding: chunked

event: open
id: 1456905833
data: {"Content-Type":"application/json",
    "ETag":"\"1456905833\""}
data: {"time":1456905833}

```

Streamed value (wrapped for readability):
```http
event: update
id: 1456905843
data: {"Content-Type":"application/json",
    "ETag":"\"1456905843\""}
data: {"time":1456905843}

```

Requesting reliable changes stream, from an older checkpoint:
```http
GET /test?reliable&after=1456905830 HTTP/1.1
Host: test.liveresource.org
Accept: text/event-stream
```

Initial response (wrapped for readability):
```http
HTTP/1.1 200 OK
Content-Type: text/event-stream
Transfer-Encoding: chunked

event: open
id: 1456905833
data: {"Content-Type":"application/json",
    "Link":"</test?after=1456905833>; rel=changes"}
data: {"time:change":"+3"}

```

Streamed changes (wrapped for readability):
```http
event: update
id: 1456905843
data: {"Content-Type":"application/json",
    "Link":"</test?after=1456905843>; rel=changes"}
data: {"time:change":"+10"}

```

The server also supports SSE stream resumption if the client includes a `Last-Event-ID` header:
```http
GET /test?reliable&after=1456905830 HTTP/1.1
Host: test.liveresource.org
Accept: text/event-stream
Last-Event-ID: 1456905843
```

The `Last-Event-ID` header takes precedence over any checkpoint information that may have been encoded in the URI.

### Socket

It is possible to stream multiple resources over a single WebSocket. There are 3 `multiplex-socket` endpoints:

* `/ws`: supports streaming `/test` or `/test2`.
* `/test/ws`: supports streaming `/test` only.
* `/test2/ws`: supports streaming `/test2` only.

The `no_share_multiplex` option can be used to tell the server to not advertise the same multiplex link for different resources. This can be useful to force clients to use different multiplex endpoints at the same time, for testing.

Once the socket is connected, requests can be issued.

Requesting a value stream:
```
GET /test
```

Acknowledgement response:
```
OK /test
```

Streamed value (wrapped for readability):
```
* /test {"Content-Type":"application/json",
    "ETag":"\"1456905843\"",
    "Previous-ETag":"\"1456905833\""}
{"time":1456905843}
```

Stop listening to a stream:
```
CANCEL /test
```

Acknowledgement response:
```
OK /test
```

Requesting a changes stream:
```
GET /test?changes
```

Acknowledgement response:
```
OK /test?changes
```

Streamed changes (wrapped for readability):
```
* /test?changes {"Content-Type":"application/json",
    "Link":"</test?after=1456905843>; rel=changes",
    "Changes-Id":"1456905843",
    "Previous-Changes-Id":"1456905833"}
{"time:change":"+10"}
```

The `Previous-ETag` and `Previous-Changes-Id` fields inside the updates can be used to detect missing data. The client can recover value data by polling the resource normally. The client can recover changes data by polling the last received `changes` link. To test client behavior in the absence of `Previous-ETag`, set the `no_previous` query parameter in the request.

### Reliable socket

The server supports reliable streaming through a WebSocket. To use it, include the `reliable` query parameter on the resources to listen on. Note that if you discover resource URIs via links, this parameter will already be included.

Requesting a reliable value stream:
```
GET /test?reliable
```

Acknowledgement response:
```
OK /test?reliable
```

Acknowledgement will be immediately followed by initial value (wrapped for readability):
```
* /test?reliable {"Content-Type":"application/json",
    "ETag":"\"1456905833\""}
{"time":1456905833}
```

Streamed value (wrapped for readability):
```
* /test {"Content-Type":"application/json",
    "ETag":"\"1456905843\""}
{"time":1456905843}
```

Requesting a reliable changes stream, from an older checkpoint:
```
GET /test?reliable&after=1456905830
```

Acknowledgement response:
```
OK /test?reliable&after=1456905830
```

Acknowledgement will be immediately followed by initial changes (wrapped for readability):
```
* /test?reliable&after=1456905830 {"Content-Type":"application/json",
    "Link":"</test?reliable&after=1456905833>; rel=changes"}
{"time:change":"+3"}
```

Streamed changes (wrapped for readability):
```
* /test?reliable&after=1456905830 {"Content-Type":"application/json",
    "Link":"</test?reliable&after=1456905843>; rel=changes"}
{"time:change":"+10"}
```
