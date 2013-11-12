var assert = require('assert')
  , fs = require('fs')
  , http = require('http')
  , path = require('path')
  , uuid = require('node-uuid')
  , request = require('request')
  , Framer = require('..')
  ;

describe('test image downloads', function () {
  var prefix = 'prefix',
      uid = uuid.v1(),
      maxAge = 3600;

  var s3Options = {
    secure: false,
    key: 'bogus',
    secret: 'bogus',
    bucket: 'bogus'
  };

  var s3Client = {
    get: function (imagePath) {
      var expectedPath = '/' + prefix + '/' + uid + '/file.txt';

      var mock = {};
      mock.on = function (evt, cb) {
        if (evt === 'response') {
          if (imagePath === expectedPath) {
            var obj = fs.createReadStream(path.join(__dirname, 'file.txt'));
            obj.statusCode = 200;
            obj.headers = {};
            obj.headers['content-type'] = 'text/html';
            cb(obj);
          }
          else {
            cb({ statusCode: 403, on: function (){} });
          }
        }
        return mock;
      };
      mock.end = function () {};
      return mock;
    }
  };

  var PORT = Math.ceil(Math.random()*2000 + 1024);
  var framer = new Framer({
    s3: s3Options
  });
  framer._s3Client = s3Client;

  var serveFile = framer.serveFile({ prefix: '/file', cacheMaxAge: maxAge });
  var client = http.createServer(function (req, res) {
    serveFile(req, res);
  }).listen(PORT);

  before(function (done) {
    client.listen(PORT, done);
  });

  it('should download non image file', function (done) {
    fs.readFile(path.join(__dirname, 'file.txt'), function (err, data) {
      var expectedFile = data;
      var url = 'http://127.0.0.1:' + PORT + '/file/' + prefix + '/' + uid + '/file.txt';

      request(url, function (err, res, body) {
        assert.ifError(err);
        assert.equal(200, res.statusCode);
        assert.equal('max-age: ' + maxAge, res.headers['cache-control']);
        assert.equal(expectedFile.toString(), body.toString());
        done();
      });
    });
  });

});
