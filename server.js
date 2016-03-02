var express = require('express');
var path = require('path');
var url = require('url');

var app = express();

var server = app.listen(process.env.PORT || 3000, function () {
	console.log('Listening on port %d', server.address().port);
});

var listeners = [];

var timeValue = 0;

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

		var l = {type: type, stream: true, res: res};
		listeners.push(l);
		req.on('close', function () {
			l.destroy();
		});
		l.destroy = function () {
			var i = listeners.indexOf(l);
			listeners.splice(i, 1);
		};

		res.set('Content-Type', 'text/event-stream');
		res.write('event: open\ndata:\n\n');
		return;
	}

	var wait = req.get('Wait');
	if(wait) {
		wait = parseInt(wait);
		if(isNaN(wait)) {
			res.status(400).send('Invalid \'Wait\' value\n');
			return;
		}
		if(wait < 0) {
			wait = 0;
		}
	} else {
		wait = 0;
	}

	if('after' in req.query) {
		var after = parseInt(req.query.after);
		if(isNaN(after)) {
			res.status(400).send('Invalid \'after\' value\n');
			return;
		}
		if(after > value) {
			// went back in time? tell the client to start over
			res.status(404).end();
			return;
		}

		var valueStr = JSON.stringify({'time:change': '+' + (value - after)});

		if(value - after == 0 && wait) {
			var l = {type: 'changes', stream: false, res: res};
			listeners.push(l);
			req.on('close', function () {
				l.destroy();
			});
			l.timer = setTimeout(function () {
				res.send(valueStr + '\n');
				l.destroy();
			}, wait * 1000);
			l.destroy = function () {
				if(l.timer) {
					clearTimeout(l.timer);
				}
				var i = listeners.indexOf(l);
				listeners.splice(i, 1);
			};
			return;
		}

		res.status(200).send(valueStr + '\n');
	} else {
		var inm = req.get('If-None-Match');
		if(inm == etag) {
			if(wait) {
				var l = {type: 'value', stream: false, res: res};
				listeners.push(l);
				req.on('close', function () {
					l.destroy();
				});
				l.timer = setTimeout(function () {
					res.status(304).end();
					l.destroy();
				}, wait * 1000);
				l.destroy = function () {
					if(l.timer) {
						clearTimeout(l.timer);
					}
					var i = listeners.indexOf(l);
					listeners.splice(i, 1);
				};
				return;
			}

			res.status(304).end();
		} else {
			res.status(200).send(JSON.stringify({time: value}) + '\n');
		}
	}
});
