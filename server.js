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
	timeValue = Math.floor(Date.now() / 1000);

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
				l.res.write('event: update\n' +
					'data: ' + JSON.stringify(meta) + '\n' +
					'data: ' + JSON.stringify({'time:change': '+' + (timeValue - old)}) + '\n\n');
			} else {
				var meta = {
					'Content-Type': 'application/json',
					'ETag': '"' + timeValue + '"',
					'Previous-ETag': '"' + old + '"'
				};
				l.res.write('event: update\n' +
					'data: ' + JSON.stringify(meta) + '\n' +
					'data: ' + JSON.stringify({time: timeValue}) + '\n\n');
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
	links.push('</test?after=' + value + '>; rel=changes');
	links.push('</test>; rel=value-stream');
	links.push('</test?changes>; rel=changes-stream');
	links.push('</test?hints>; rel=hint-stream');

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

		var l = {type: type, res: res};
		listeners.push(l);
		req.on('close', function () {
			var i = listeners.indexOf(l);
			listeners.splice(i, 1);
		});

		res.set('Content-Type', 'text/event-stream');
		res.write('event: open\ndata:\n\n');
		return;
	}

	if('after' in req.query) {
		var after = parseInt(req.query.after);
		if(after > value) {
			// went back in time? tell the client to start over
			res.status(404).end();
			return;
		}
		res.status(200).send(JSON.stringify({'time:change': '+' + (value - after)}) + '\n');
	} else {
		var inm = req.get('If-None-Match');
		if (inm == etag) {
			res.status(304).end();
		} else {
			res.status(200).send(JSON.stringify({time: value}) + '\n');
		}
	}
});
