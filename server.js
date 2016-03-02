var express = require('express');
var path = require('path');
var url = require('url');

var app = express();

var server = app.listen(process.env.PORT || 3000, function () {
	console.log('Listening on port %d', server.address().port);
});

var listeners = [];

// options:
//   req: request object
//   res: response object
//   type: value|changes|hint
//   stream: bool
//   wait: int
//   response: response body if wait times out
//   responseStatus: response status code if wait times out
//   timeout: int
var newListener = function (options) {
	var l = {req: options.req, res: options.res, type: options.type, stream: options.stream};
	listeners.push(l);
	options.req.on('close', function () {
		l.destroy();
	});
	l.timer = setTimeout(function () {
		l.timer = null;
		l.res.status(options.responseStatus || 200).send(options.response || '');
		l.destroy();
	}, options.wait * 1000);
	if(options.timeout) {
		l.timeoutTimer = setTimeout(function () {
			l.timeoutTimer = null;
			l.res.socket.destroy();
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

var timeValue = Math.floor(Date.now() / 1000);

setInterval(function () {
	var old = timeValue;
	var cur = Math.floor(Date.now() / 1000);
	if(cur % 10 == 0) {
		timeValue = cur;
	}

	if(timeValue != old) {
		for(var i = 0; i < listeners.length; ++i) {
			var l = listeners[i];
			if(l.type == 'hint') {
				l.res.write('event: update\ndata:\n\n');
			} else if(l.type == 'changes') {
				var meta = {
					'Content-Type': 'application/json',
					'Changes-Id': '' + timeValue,
					'Previous-Changes-Id': '' + old
				};
				var valueStr = JSON.stringify({'time:change': '+' + (timeValue - old)});
				if(l.stream) {
					l.res.write('event: update\n' +
						'data: ' + JSON.stringify(meta) + '\n' +
						'data: ' + valueStr + '\n\n');
				} else {
					l.res.set(meta);
					l.res.send(valueStr + '\n');
					l.destroy();
				}
			} else {
				var meta = {
					'Content-Type': 'application/json',
					'ETag': '"' + timeValue + '"',
					'Previous-ETag': '"' + old + '"'
				};
				var valueStr = JSON.stringify({time: timeValue});
				if(l.stream) {
					l.res.write('event: update\n' +
						'data: ' + JSON.stringify(meta) + '\n' +
						'data: ' + valueStr + '\n\n');
				} else {
					l.res.set(meta);
					l.res.send(valueStr + '\n');
					l.destroy();
				}
			}
		}
	}
}, 100);

var getTime = function () {
	return timeValue;
};

var headerHandler = function (value, req, res) {
	var etag = '"' + value + '"';
	res.set('ETag', etag);

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
			'hint-stream': 1
		};
	}

	var allowHeaders = ['If-None-Match', 'Wait'];
	var exposeHeaders = [];
	exposeHeaders.push('ETag');
	exposeHeaders.push('Previous-ETag');
	exposeHeaders.push('Changes-Id');
	exposeHeaders.push('Previous-Changes-Id');

	if('no_poll_header' in req.query) {
		res.set('X-Poll-Interval', '10');
		exposeHeaders.push('X-Poll-Interval');
	}

	var links = [];
	if('changes' in relTypes) {
		links.push('</test?after=' + value + '>; rel=changes');
	}
	if('value-wait' in relTypes) {
		links.push('</test>; rel=value-wait');
	}
	if('changes-wait' in relTypes) {
		links.push('</test?after=' + value + '>; rel=changes-wait');
	}
	if('value-stream' in relTypes) {
		links.push('</test>; rel=value-stream');
	}
	if('changes-stream' in relTypes) {
		links.push('</test?changes>; rel=changes-stream');
	}
	if('hint-stream' in relTypes) {
		links.push('</test?hints>; rel=hint-stream');
	}

	if(links.length > 0) {
		res.set('Link', links.join(', '));
		exposeHeaders.push('Link');
	}

	res.set('Changes-Id', '' + value);

	// cors
	res.set('Access-Control-Max-Age', '3600');
	res.set('Access-Control-Allow-Origin', req.get('Origin') || '*');
	if(allowHeaders.length > 0) {
		res.set('Access-Control-Allow-Headers', allowHeaders.join(', '));
	}
	if(exposeHeaders.length > 0) {
		res.set('Access-Control-Expose-Headers', exposeHeaders.join(', '));
	}

	return etag;
};

app.head('/test', function (req, res) {
	var value = getTime();
	headerHandler(value, req, res);
	res.send('')
});

app.get('/test', function (req, res) {
	var value = getTime();
	var etag = headerHandler(value, req, res);

	var timeout = null;
	if('timeout' in req.query) {
		timeout = parseInt(req.query.timeout);
		if(isNaN(timeout) || timeout < 0) {
			res.status(400).send('Invalid \'timeout\' value.\n');
			return;
		}
	}

	var sse = false;
	var accept = req.get('Accept');
	if(accept) {
		// do SSE only if mime type explicitly specified
		accept = accept.split(',');
		for(var i = 0; i < accept.length; ++i) {
			if(accept[i].split(';')[0].trim() == 'text/event-stream') {
				sse = true;
				break;
			}
		}
	}

	if(sse) {
		var type;
		if('hints' in req.query) {
			type = 'hint';
		} else if('changes' in req.query) {
			type = 'changes';
		} else {
			type = 'value';
		}

		newListener({
			req: req,
			res: res,
			type: type,
			stream: true,
			timeout: timeout
		});

		res.set('Content-Type', 'text/event-stream');
		res.write('event: open\ndata:\n\n');
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

	if('after' in req.query) {
		var after = parseInt(req.query.after);
		if(isNaN(after)) {
			res.status(400).send('Invalid \'after\' value.\n');
			return;
		}
		if(after > value) {
			// went back in time? tell the client to start over
			res.status(404).end('Invalid changes URI, start over.\n');
			return;
		}

		var valueStr = JSON.stringify({'time:change': '+' + (value - after)});

		if(value - after == 0 && wait) {
			newListener({
				req: req,
				res: res,
				type: 'changes',
				stream: false,
				wait: wait,
				response: valueStr + '\n',
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
					type: 'value',
					stream: false,
					wait: wait,
					responseStatus: 304,
					timeout: timeout
				});
				return;
			}

			res.status(304).end();
		} else {
			res.status(200).send(JSON.stringify({time: value}) + '\n');
		}
	}
});
