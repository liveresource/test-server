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
	if(!req.query.no_poll_header)
		res.set('X-Poll-Interval', '' + 10);
};

app.head('/test', function (req, res) {
	var value = getTime();
	headerHandler(value, req, res);
	res.send('')
});

app.get('/test', function (req, res) {
	var value = getTime();
	headerHandler(value, req, res);
	res.json({time: value});
});
