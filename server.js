var express = require('express');
var app = express();
var soratamafy = require('./index.js').soratamafy;

app.post('/soratamafy', soratamafy);

// app.post('/test', function(req,res){
//     res.send('Hello World!');
//     return;
// });

app.get('/test', function(req,res){
    res.send('Hello World!');
    return;
});

app.listen(3000, function() {
    console.log('Listening...');
});
