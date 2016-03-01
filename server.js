var express = require('express');
var path = require('path');
var url = require('url');

var app = express();

var server = app.listen(process.env.PORT || 3000, function () {
	console.log('Listening on port %d', server.address().port);
});

var timeValue = 0;

setInterval(function () {
	timeValue = Math.floor(Date.now() / 1000);
}, 100);

var getTime = function () {
	return timeValue;
};

var headerHandler = function (value, req, res) {
	var etag = '"' + value + '"';
	res.set('ETag', etag);

	var allowHeaders = ['If-None-Match', 'Wait'];
	var exposeHeaders = [];

	if(!req.query.no_poll_header) {
		res.set('X-Poll-Interval', '10');
		exposeHeaders.push('X-Poll-Interval');
	}

	var links = [];
	links.push('</test?after=' + value + '>; rel=changes');

	if(links.length > 0) {
		res.set('Link', links.join(', '));
		exposeHeaders.push('Link');
	}

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

	if(req.query.after) {
		var after = parseInt(req.query.after);
		if(after > value) {
			// went back in time? tell the client to start over
			res.status(404).end();
			return;
		}
		res.status(200).json({'time:change': '+' + (value - after)});
	} else {
		var inm = req.get('If-None-Match');
		if (inm == etag) {
			res.status(304).end();
		} else {
			res.status(200).json({time: value});
		}
	}
});
