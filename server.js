var express = require('express');
var path = require('path');
var url = require('url');
var WebSocketServer = require('ws').Server;

var app = express();

var server = app.listen(process.env.PORT || 3000, function () {
	console.log('Listening on port %d', server.address().port);
});

var listeners = [];

// path object:
//   path: uri canonical path
//   uri: uri registered by client
//   type: value|changes|hint
//   response: response body if wait times out
//   responseStatus: response status code if wait times out
//   responseHeaders: response headers if wait times out
//   reliable: bool
// options:
//   req: request object
//   res: response object
//   paths: list of path objects
//   stream: bool
//   multi: bool
//   wait: int
//   timeout: int
//   noPrevious: bool
var newListener = function (options) {
	var l = {
		req: options.req,
		res: options.res,
		ws: options.ws,
		paths: options.paths,
		stream: options.stream,
		multi: options.multi,
		noPrevious: options.noPrevious
	};
	listeners.push(l);
	if(l.req) {
		l.req.on('close', function () {
			l.destroy();
		});
	}
	if(l.ws) {
		l.ws.on('close', function () {
			//console.log('ws connection closed');
			l.ws.close();
			l.destroy();
		});
	}
	if(options.wait) {
		l.timer = setTimeout(function () {
			l.timer = null;
			if(l.multi) {
				var responses = {};
				for(var i = 0; i < l.paths.length; ++i) {
					var p = l.paths[i];
					responses[p.path] = {
						code: p.responseStatus || 200,
						body: p.response || ''
					};
					if(p.responseHeaders) {
						responses[p.path].headers = p.responseHeaders;
					}
				}
				l.res.status(200).send(JSON.stringify(responses) + '\n');
			} else {
				l.res.status(options.responseStatus || 200).send(options.response || '');
			}
			l.destroy();
		}, options.wait * 1000);
	}
	if(options.timeout) {
		l.timeoutTimer = setTimeout(function () {
			l.timeoutTimer = null;
			if(l.res) {
				l.res.socket.destroy();
			} else if(l.ws) {
				l.ws.close();
			}
			l.destroy();
		}, options.timeout * 1000);
	}
	l.destroy = function () {
		if(l.timer) {
			clearTimeout(l.timer);
			l.timer = null;
		}
		if(l.timeoutTimer) {
			clearTimeout(l.timeoutTimer);
			l.timeoutTimer = null;
		}
		var i = listeners.indexOf(l);
		listeners.splice(i, 1);
	};

	return l;
}

var offset2 = 3600; // 1 hour

var timeValue = Math.floor(Date.now() / 1000);
var timeValue2 = timeValue + offset2;

setInterval(function () {
	var oldTimeValue = timeValue;
	var oldTimeValue2 = timeValue2;

	var cur = Math.floor(Date.now() / 1000);
	if(cur % 3 == 0) {
		timeValue = cur;
	}

	var cur2 = cur + offset2;
	if(cur2 % 10 == 0) {
		timeValue2 = cur2;
	}

	if(timeValue == oldTimeValue && timeValue2 == oldTimeValue2) {
		// no change
		return;
	}

	for(var i = 0; i < listeners.length; ++i) {
		var l = listeners[i];

		for(var k = 0; k < l.paths.length; ++k) {
			var p = l.paths[k];

			var value;
			var old;
			if(timeValue != oldTimeValue && p.path == '/test') {
				value = timeValue;
				old = oldTimeValue;
			} else if(timeValue2 != oldTimeValue2 && p.path == '/test2') {
				value = timeValue2;
				old = oldTimeValue2;
			} else {
				continue;
			}

			// drop messages to simulate unreliability
			if(!p.reliable && value % 30 == 0) {
				continue;
			}

			if(p.type == 'hint') {
				if(l.res) {
					l.res.write('event: update\ndata:\n\n');
				} else if(l.ws) {
					l.ws.send('* ' + p.uri);
				}
			} else if(p.type == 'changes') {
				var links = [];
				if(p.reliable) {
					links.push('<' + p.path + '?reliable&after=' + value + '>; rel=changes-stream');
				} else {
					links.push('<' + p.path + '?after=' + value + '>; rel=changes');
				}
				var meta = {
					'Content-Type': 'application/json',
					'Link': links.join(', ')
				};
				if(l.stream && !p.reliable) {
					meta['Changes-Id'] = '' + value;
					meta['Previous-Changes-Id'] = '' + old;
				}
				var valueStr = JSON.stringify({'time:change': '+' + (value - old)});
				if(l.stream) {
					if(l.res) {
						var s = 'event: update\n';
						if(p.reliable) {
							s += 'id: ' + value + '\n';
						}
						s += 'data: ' + JSON.stringify(meta) + '\ndata: ' + valueStr + '\n\n';
						l.res.write(s);
					} else if(l.ws) {
						l.ws.send('* ' + p.uri + ' ' + JSON.stringify(meta) + '\n' + valueStr);
					}
				} else {
					if(l.multi) {
						var responses = {};
						responses[p.path] = {
							code: 200,
							headers: meta,
							body: valueStr + '\n'
						};
						l.res.send(JSON.stringify(responses) + '\n');
					} else {
						l.res.set(meta);
						l.res.send(valueStr + '\n');
					}
					l.destroy();
				}
			} else {
				var meta = {
					'Content-Type': 'application/json',
					'ETag': '"' + value + '"',
				};
				if(l.stream && !p.reliable && !l.noPrevious) {
					meta['Previous-ETag'] = '"' + old + '"';
				}
				var valueStr = JSON.stringify({time: value});
				if(l.stream) {
					if(l.res) {
						var s = 'event: update\n';
						if(p.reliable) {
							s += 'id: ' + value + '\n';
						}
						s += 'data: ' + JSON.stringify(meta) + '\ndata: ' + valueStr + '\n\n';
						l.res.write(s);
					} else if(l.ws) {
						l.ws.send('* ' + p.uri + ' ' + JSON.stringify(meta) + '\n' + valueStr);
					}
				} else {
					if(l.multi) {
						var responses = {};
						responses[p.path] = {
							code: 200,
							headers: meta,
							body: valueStr + '\n'
						};
						l.res.send(JSON.stringify(responses) + '\n');
					} else {
						l.res.set(meta);
						l.res.send(valueStr + '\n');
					}
					l.destroy();
				}
			}
		}
	}
}, 100);

var getTime = function () {
	return timeValue;
};

var getTime2 = function () {
	return timeValue2;
};

var applyCors = function (req, res, allowHeaders, exposeHeaders) {
	res.set('Access-Control-Max-Age', '3600');
	res.set('Access-Control-Allow-Origin', req.get('Origin') || '*');
	if(allowHeaders.length > 0) {
		res.set('Access-Control-Allow-Headers', allowHeaders.join(', '));
	}
	if(exposeHeaders.length > 0) {
		res.set('Access-Control-Expose-Headers', exposeHeaders.join(', '));
	}
};

var headerHandler = function (value, req, res) {
	var etag = '"' + value + '"';
	res.set('ETag', etag);

	var reliable = false;
	if('reliable' in req.query) {
		reliable = true;
	}

	var relTypes;
	if(req.query.types) {
		relTypes = {};
		var parts = req.query.types.split(',');
		for(var i = 0; i < parts.length; ++i) {
			relTypes[parts[i].trim()] = 1;
		}
	} else {
		relTypes = {
			'changes': 1,
			'value-wait': 1,
			'value-stream': 1,
			'changes-wait': 1,
			'changes-stream': 1,
			'hint-stream': 1,
			'multiplex-wait': 1,
			'multiplex-socket': 1
		};
	}

	var allowHeaders = ['If-None-Match', 'Wait', 'Uri'];
	var exposeHeaders = [];
	exposeHeaders.push('ETag');
	exposeHeaders.push('Previous-ETag');
	exposeHeaders.push('Changes-Id');
	exposeHeaders.push('Previous-Changes-Id');

	if(!('no_poll_header' in req.query)) {
		res.set('X-Poll-Interval', '10');
		exposeHeaders.push('X-Poll-Interval');
	}

	var noShareMultiplex = false;
	if('no_share_multiplex' in req.query) {
		noShareMultiplex = true;
	}

	var links = [];
	if('changes' in relTypes) {
		links.push('<' + req.path + '?after=' + value + '>; rel=changes');
	}
	if('value-wait' in relTypes) {
		links.push('<' + req.path + '>; rel=value-wait');
	}
	if('changes-wait' in relTypes) {
		links.push('<' + req.path + '?after=' + value + '>; rel=changes-wait');
	}
	if('value-stream' in relTypes) {
		if(reliable) {
			links.push('<' + req.path + '?reliable>; rel=value-stream; mode=reliable');
		} else {
			links.push('<' + req.path + '>; rel=value-stream');
		}
	}
	if('changes-stream' in relTypes) {
		if(reliable) {
			links.push('<' + req.path + '?reliable&after=' + value + '>; rel=changes-stream; mode=reliable');
		} else {
			links.push('<' + req.path + '?changes>; rel=changes-stream');
		}
	}
	if('hint-stream' in relTypes) {
		links.push('<' + req.path + '?hints>; rel=hint-stream');
	}
	if('multiplex-wait' in relTypes) {
		if(noShareMultiplex) {
			links.push('<' + req.path + '/multi>; rel=multiplex-wait');
		} else {
			links.push('</multi>; rel=multiplex-wait');
		}
	}
	if('multiplex-socket' in relTypes) {
		if(noShareMultiplex) {
			links.push('<' + req.path + '/ws>; rel=multiplex-socket');
		} else {
			links.push('</ws>; rel=multiplex-socket');
		}
	}

	if(links.length > 0) {
		res.set('Link', links.join(', '));
		exposeHeaders.push('Link');
	}

	res.set('Changes-Id', '' + value);

	applyCors(req, res, allowHeaders, exposeHeaders);

	return etag;
};

var handler = function (value, req, res) {
	var etag = headerHandler(value, req, res);

	var reliable = false;
	if('reliable' in req.query) {
		reliable = true;
	}

	var noPrevious = false;
	if('no_previous' in req.query) {
		noPrevious = true;
	}

	var timeout = null;
	if('timeout' in req.query) {
		timeout = parseInt(req.query.timeout);
		if(isNaN(timeout) || timeout < 0) {
			res.status(400).send('Invalid \'timeout\' value.\n');
			return;
		}
	}

	var after = null;
	if('after' in req.query) {
		after = parseInt(req.query.after);
		if(isNaN(after)) {
			res.status(400).send('Invalid \'after\' value.\n');
			return;
		}
		if(after > value) {
			// went back in time? tell the client to start over
			res.status(404).end('Invalid changes URI, start over.\n');
			return;
		}
	}

	var lastEventId = req.get('Last-Event-ID');
	if(lastEventId) {
		lastEventId = parseInt(lastEventId);
		if(isNaN(lastEventId) || lastEventId < 0) {
			res.status(400).send('Invalid \'Last-Event-ID\' value.\n');
			return;
		}
		if(lastEventId > value) {
			// went back in time? tell the client to start over
			res.status(404).end('Invalid \'Last-Event-ID\', start over.\n');
			return;
		}
	}

	var stream = false;
	if('stream' in req.query) {
		stream = true;
	}

	var explicitlyAcceptSse = false;
	var accept = req.get('Accept');
	if(accept) {
		accept = accept.split(',');
		for(var i = 0; i < accept.length; ++i) {
			if(accept[i].split(';')[0].trim() == 'text/event-stream') {
				explicitlyAcceptSse = true;
				break;
			}
		}
	}

	if(stream || explicitlyAcceptSse) {
		// Last-Event-ID supersedes 'after' query param
		if(lastEventId) {
			after = lastEventId;
		}

		var type;
		if('hints' in req.query) {
			type = 'hint';
		} else if(after != null || 'changes' in req.query) {
			type = 'changes';
		} else {
			type = 'value';
		}

		if(type == 'changes' && reliable && after == null) {
			res.status(400).send('Reliable changes stream requires \'after\' parameter or \'Last-Event-ID\' header.\n');
			return;
		}

		newListener({
			req: req,
			res: res,
			paths: [{path: req.path, type: type, reliable: reliable}],
			stream: true,
			timeout: timeout,
			noPrevious: noPrevious
		});

		res.set('Content-Type', 'text/event-stream');

		if(reliable) {
			// write initial data
			if(type == 'changes') {
				var links = [];
				links.push('<' + req.path + '?reliable&after=' + value + '>; rel=changes-stream');
				var meta = {
					'Content-Type': 'application/json',
					'Link': links.join(', ')
				};
				var valueStr = JSON.stringify({'time:change': '+' + (value - after)});
				res.write('event: open\n' +
					'id: ' + value + '\n' +
					'data: ' + JSON.stringify(meta) + '\n' +
					'data: ' + valueStr + '\n\n');
			} else if(type == 'value') {
				var meta = {
					'Content-Type': 'application/json',
					'ETag': '"' + value + '"'
				};
				var valueStr = JSON.stringify({time: value});
				res.write('event: open\n' +
					'id: ' + value + '\n' +
					'data: ' + JSON.stringify(meta) + '\n' +
					'data: ' + valueStr + '\n\n');
			}
		} else {
			res.write('event: open\ndata:\n\n');
		}

		return;
	}

	var wait = req.get('Wait');
	if(wait) {
		wait = parseInt(wait);
		if(isNaN(wait) || wait < 0) {
			res.status(400).send('Invalid \'Wait\' value.\n');
			return;
		}
	} else {
		wait = 0;
	}

	if(after != null) {
		var valueStr = JSON.stringify({'time:change': '+' + (value - after)});

		if(value - after == 0 && wait) {
			newListener({
				req: req,
				res: res,
				paths: [{path: req.path, type: 'changes', response: valueStr + '\n'}],
				wait: wait,
				timeout: timeout
			});
			return;
		}

		res.status(200).send(valueStr + '\n');
	} else {
		var inm = req.get('If-None-Match');
		if(inm == etag) {
			if(wait) {
				newListener({
					req: req,
					res: res,
					paths: [{path: req.path, type: 'value', responseStatus: 304}],
					wait: wait,
					timeout: timeout
				});
				return;
			}

			res.status(304).end();
		} else {
			res.status(200).send(JSON.stringify({time: value}) + '\n');
		}
	}
};

// return {uri, inm}
var parseUriHeader = function (h) {
	if(h.length < 2 || h[0] != '<') {
		return null;
	}

	var i = h.indexOf('>', 1);
	if(i < 0) {
		return null;
	}

	var uri = h.substring(1, i);
	var inm = null;

	i = h.indexOf(';', i + 1);
	if(i >= 0) {
		var param = h.substring(i + 1).trim();
		i = param.indexOf('=');
		if(i < 0) {
			return null;
		}

		if(param.substring(0, i).toLowerCase() == 'if-none-match') {
			inm = param.substring(i + 1);
		}
	}

	return {uri: uri, inm: inm};
};

var multiHandler = function (allowed, req, res) {
	var allowHeaders = ['If-None-Match', 'Wait', 'Uri'];
	var exposeHeaders = [];
	exposeHeaders.push('ETag');
	exposeHeaders.push('Previous-ETag');
	exposeHeaders.push('Changes-Id');
	exposeHeaders.push('Previous-Changes-Id');

	if(!('no_poll_header' in req.query)) {
		res.set('X-Poll-Interval', '10');
		exposeHeaders.push('X-Poll-Interval');
	}

	applyCors(req, res, allowHeaders, exposeHeaders);

	var uri = req.get('Uri');
	if(!uri) {
		res.status(400).send('No \'Uri\' header.\n');
		return;
	}

	var timeout = null;
	if('timeout' in req.query) {
		timeout = parseInt(req.query.timeout);
		if(isNaN(timeout) || timeout < 0) {
			res.status(400).send('Invalid \'timeout\' value.\n');
			return;
		}
	}

	var wait = req.get('Wait');
	if(wait) {
		wait = parseInt(wait);
		if(isNaN(wait) || wait < 0) {
			res.status(400).send('Invalid \'Wait\' value.\n');
			return;
		}
	} else {
		wait = 0;
	}

	var ulist = [];
	var parts = uri.split(',');
	for(var i = 0; i < parts.length; ++i) {
		var u = parseUriHeader(parts[i].trim());
		if(!u) {
			res.status(400).send('Invalid \'Uri\' header.\n');
			return;
		}

		var parsed = url.parse(u.uri, true);
		u.path = parsed.pathname;
		u.query = parsed.query;

		for(var k = 0; k < ulist.length; ++k) {
			if(ulist[k].path == u.path) {
				res.status(400).send('Duplicate multi request path.\n');
				return;
			}
		}

		ulist.push(u);
	}

	var haveResponses = false;
	var responses = {};
	var listenPaths = [];

	for(var i = 0; i < ulist.length; ++i) {
		var u = ulist[i];

		if(allowed.indexOf(u.path) == -1) {
			res.status(400).send('Invalid multi request path.\n');
			return;
		}

		var value;
		if(u.path == '/test') {
			value = getTime();
		} else if(u.path == '/test2') {
			value = getTime2();
		} else {
			res.status(400).send('Invalid multi request path.\n');
			return;
		}

		var headers = {};

		var etag = '"' + value + '"';
		headers['ETag'] = etag;

		var links = [];
		links.push('<' + u.path + '?after=' + value + '>; rel=changes');

		headers['Link'] = links.join(', ');

		var after = null;
		if('after' in u.query) {
			after = parseInt(u.query.after);
			if(isNaN(after)) {
				res.status(400).send('Invalid \'after\' value.\n');
				return;
			}
		}

		if(after != null) {
			if(after > value) {
				// went back in time? tell the client to start over
				responses[u.path] = {
					code: 404,
					headers: headers,
					body: 'Invalid changes URI, start over.\n'
				};

				haveResponses = true;
				continue;
			}

			// changes
			var valueStr = JSON.stringify({'time:change': '+' + (value - after)});

			if(value - after == 0 && wait) {
				listenPaths.push({
					path: u.path,
					type: 'changes',
					response: valueStr + '\n',
					responseHeaders: headers
				});
				continue;
			}

			responses[u.path] = {
				code: 200,
				headers: headers,
				body: valueStr + '\n'
			};

			haveResponses = true;
		} else {
			// value
			if(u.inm == etag) {
				if(wait) {
					listenPaths.push({
						path: u.path,
						type: 'value',
						responseStatus: 304,
						responseHeaders: headers
					});
					continue;
				}

				responses[u.path] = {
					code: 304,
					headers: headers
				};

				haveResponses = true;
			} else {
				responses[u.path] = {
					code: 200,
					headers: headers,
					body: JSON.stringify({time: value}) + '\n'
				};

				haveResponses = true;
			}
		}
	}

	if(haveResponses) {
		res.send(JSON.stringify(responses) + '\n');
	} else {
		newListener({
			req: req,
			res: res,
			paths: listenPaths,
			multi: true,
			wait: wait,
			timeout: timeout
		});
	}
};

app.head('/test', function (req, res) {
	var value = getTime();
	headerHandler(value, req, res);
	res.send('');
});

app.get('/test', function (req, res) {
	var value = getTime();
	handler(value, req, res);
});

app.head('/test2', function (req, res) {
	var value = getTime2();
	headerHandler(value, req, res);
	res.send('');
});

app.get('/test2', function (req, res) {
	var value = getTime2();
	handler(value, req, res);
});

app.get('/multi', function (req, res) {
	multiHandler(['/test', '/test2'], req, res);
});

app.get('/test/multi', function (req, res) {
	multiHandler(['/test'], req, res);
});

app.get('/test2/multi', function (req, res) {
	multiHandler(['/test2'], req, res);
});

var wsEndpoints = {
	'/ws': ['/test', '/test2'],
	'/test/ws': ['/test'],
	'/test2/ws': ['/test2']
};

for(var e in wsEndpoints) {
	var allowed = wsEndpoints[e];

	var wss = new WebSocketServer({
		server: server,
		path: e,
		handleProtocols: function (protocols, cb) {
			if (protocols && protocols.indexOf('liveresource') != -1) {
				cb(true, 'liveresource');
			} else {
				cb(true);
			}
		}
	});

	(function (path, allowed) {
		wss.on('connection', function (ws) {
			//console.log('ws connection opened: ' + path);

			var parsed = url.parse(ws.upgradeReq.url, true);

			var noPrevious = false;
			if('no_previous' in parsed.query) {
				noPrevious = true;
			}

			var timeout = null;
			if('timeout' in parsed.query) {
				timeout = parseInt(parsed.query.timeout);
				if(isNaN(timeout) || timeout < 0) {
					ws.close();
					return;
				}
			}

			var l = newListener({
				ws: ws,
				paths: [],
				stream: true,
				multi: true,
				timeout: timeout,
				noPrevious: noPrevious
			});

			ws.on('message', function (message) {
				var args = message.split(' ');

				if(args.length < 2) {
					ws.send('ERROR * 400\nBad format.');
					return;
				}

				var method = args[0].toUpperCase();
				var uri = args[1];

				if(uri.length == 0) {
					ws.send('ERROR * 400\nBad format.');
					return;
				}

				if(method.length == 0) {
					ws.send('ERROR ' + uri + ' 400\nBad format.');
					return;
				}

				var parsed = url.parse(uri, true);

				var u = {};
				u.path = parsed.pathname;
				u.query = parsed.query;

				var reliable = false;
				if('reliable' in u.query) {
					reliable = true;
				}

				if(allowed.indexOf(u.path) == -1) {
					// not an allowed path
					ws.send('ERROR ' + uri + ' 400\nInvalid multi request path.');
					return;
				}

				var after = null;
				if('after' in u.query) {
					after = parseInt(u.query.after);
					if(isNaN(after)) {
						ws.send('ERROR ' + uri + ' 400\nInvalid \'after\' value.');
						return;
					}
				}

				if(method == 'GET') {
					for(var i = 0; i < l.paths.length; ++i) {
						if(l.paths[i].path == u.path) {
							// already listening
							ws.send('ERROR ' + uri + ' 400\nAlready listening.');
							return;
						}
					}

					var value;
					if(u.path == '/test') {
						value = getTime();
					} else if(u.path == '/test2') {
						value = getTime2();
					} else {
						ws.send('ERROR ' + uri + ' 404\nNot found');
						return;
					}

					var type;
					if('hints' in u.query) {
						type = 'hint';
					} else if(after != null || 'changes' in u.query) {
						type = 'changes';
					} else {
						type = 'value';
					}

					if(type == 'changes' && reliable && after == null) {
						// reliable changes requires after param
						ws.send('ERROR ' + uri + ' 400\nReliable changes stream requires \'after\' parameter.');
						return;
					}

					l.paths.push({
						path: u.path,
						uri: uri,
						type: type,
						reliable: reliable
					});
					ws.send('OK ' + uri);

					if(reliable) {
						// write initial data
						if(type == 'changes') {
							var links = [];
							links.push('<' + u.path + '?reliable&after=' + value + '>; rel=changes');
							var meta = {
								'Content-Type': 'application/json',
								'Link': links.join(', ')
							};
							var valueStr = JSON.stringify({'time:change': '+' + (value - after)});
							ws.send('* ' + uri + ' ' + JSON.stringify(meta) + '\n' + valueStr);
						} else if(type == 'value') {
							var meta = {
								'Content-Type': 'application/json',
								'ETag': '"' + value + '"'
							};
							var valueStr = JSON.stringify({time: value});
							ws.send('* ' + uri + ' ' + JSON.stringify(meta) + '\n' + valueStr);
						}
					}
				} else if(method == 'CANCEL') {
					for(var i = 0; i < l.paths.length; ++i) {
						var p = l.paths[i];
						if(p.path == u.path) {
							l.paths.splice(i, 1);
							ws.send('OK ' + p.uri);
							return;
						}
					}
					if(!found) {
						// wasn't listening
						ws.send('ERROR ' + uri + ' 400\nWasn\'t listening.');
						return;
					}
				} else {
					ws.send('ERROR ' + uri + ' 405\nMethod not allowed.');
				}
			});
		});
	}(e, allowed));
}
