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
	var l = {
		req: options.req,
		res: options.res,
		type: options.type,
		stream: options.stream,
		reliable: options.reliable
	};
	listeners.push(l);
	options.req.on('close', function () {
		l.destroy();
	});
	if(options.wait) {
		l.timer = setTimeout(function () {
			l.timer = null;
			l.res.status(options.responseStatus || 200).send(options.response || '');
			l.destroy();
		}, options.wait * 1000);
	}
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

		var value;
		var old;
		if(timeValue != oldTimeValue && l.req.path == '/test') {
			value = timeValue;
			old = oldTimeValue;
		} else if(timeValue2 != oldTimeValue2 && l.req.path == '/test2') {
			value = timeValue2;
			old = oldTimeValue2;
		} else {
			continue;
		}

		// drop messages to simulate unreliability
		if(!l.reliable && value % 30 == 0) {
			continue;
		}

		if(l.type == 'hint') {
			l.res.write('event: update\ndata:\n\n');
		} else if(l.type == 'changes') {
			var links = [];
			if(l.reliable) {
				links.push('<' + req.path + '?reliable&after=' + value + '>; rel=changes-stream');
			} else {
				links.push('<' + req.path + '?after=' + value + '>; rel=changes');
			}
			var meta = {
				'Content-Type': 'application/json',
				'Link': links.join(', ')
			};
			if(!l.reliable) {
				meta['Changes-Id'] = '' + value;
				meta['Previous-Changes-Id'] = '' + old;
			}
			var valueStr = JSON.stringify({'time:change': '+' + (value - old)});
			if(l.stream) {
				var s = 'event: update\n';
				if(l.reliable) {
					s += 'id: ' + value + '\n';
				}
				s += 'data: ' + JSON.stringify(meta) + '\ndata: ' + valueStr + '\n\n';
				l.res.write(s);
			} else {
				l.res.set(meta);
				l.res.send(valueStr + '\n');
				l.destroy();
			}
		} else {
			var meta = {
				'Content-Type': 'application/json',
				'ETag': '"' + value + '"',
			};
			if(!l.reliable) {
				meta['Previous-ETag'] = '"' + old + '"';
			}
			var valueStr = JSON.stringify({time: value});
			if(l.stream) {
				var s = 'event: update\n';
				if(l.reliable) {
					s += 'id: ' + value + '\n';
				}
				s += 'data: ' + JSON.stringify(meta) + '\ndata: ' + valueStr + '\n\n';
				l.res.write(s);
			} else {
				l.res.set(meta);
				l.res.send(valueStr + '\n');
				l.destroy();
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
			'hint-stream': 1
		};
	}

	var allowHeaders = ['If-None-Match', 'Wait'];
	var exposeHeaders = [];
	exposeHeaders.push('ETag');
	exposeHeaders.push('Previous-ETag');
	exposeHeaders.push('Changes-Id');
	exposeHeaders.push('Previous-Changes-Id');

	if(!('no_poll_header' in req.query)) {
		res.set('X-Poll-Interval', '10');
		exposeHeaders.push('X-Poll-Interval');
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

var handler = function (value, req, res) {
	var etag = headerHandler(value, req, res);

	var reliable = false;
	if('reliable' in req.query) {
		reliable = true;
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
			type: type,
			stream: true,
			timeout: timeout,
			reliable: reliable
		});

		res.set('Content-Type', 'text/event-stream');
		res.write('event: open\ndata:\n\n');

		if(reliable) {
			// write initial data
			if(type == 'changes') {
				if(value - after > 0) {
					var links = [];
					links.push('<' + req.path + '?reliable&after=' + value + '>; rel=changes-stream');
					var meta = {
						'Content-Type': 'application/json',
						'Link': links.join(', ')
					};
					var valueStr = JSON.stringify({'time:change': '+' + (value - after)});
					res.write('event: update\n' +
						'id: ' + value + '\n' +
						'data: ' + JSON.stringify(meta) + '\n' +
						'data: ' + valueStr + '\n\n');
				}
			} else if(type == 'value') {
				var meta = {
					'Content-Type': 'application/json',
					'ETag': '"' + value + '"'
				};
				var valueStr = JSON.stringify({time: value});
				res.write('event: update\n' +
					'id: ' + value + '\n' +
					'data: ' + JSON.stringify(meta) + '\n' +
					'data: ' + valueStr + '\n\n');
			}
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
