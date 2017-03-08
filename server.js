const express = require('express');
const app = express();
const nconf = require('nconf');

nconf
.argv()
.env()
.defaults({
  PORT: 3000
});

app.get('/', function (req, res) {
  res.send('Hello World!')
});

app.listen(nconf.get('PORT'), function () {
  console.log(`Example app listening on port ${nconf.get('PORT')}!`);
});
