var assert = require('assert')
  , fs = require('fs')
  , http = require('http')
  , path = require('path')
  , uuid = require('node-uuid')
  , gm = require('gm')
  , request = require('request')
  , buffertools = require('buffertools')
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
      var expectedPath = '/' + prefix + '/' + uid + '/image.jpg';

      var mock = {};
      mock.on = function (evt, cb) {
        if (evt === 'response') {
          if (imagePath === expectedPath) {
            var obj = fs.createReadStream(path.join(__dirname, 'image.jpg'));
            obj.statusCode = 200;
            obj.headers = {};
            obj.headers['content-type'] = 'image/jpeg';
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
    },
  };

  var PORT = Math.ceil(Math.random()*2000 + 1024);
  var framer = new Framer({
    s3: s3Options
  });
  framer._s3Client = s3Client;

  var serveImage = framer.serveImage({ prefix: '/img', cacheMaxAge: maxAge });
  var client = http.createServer(function (req, res) {
    serveImage(req, res);
  }).listen(PORT);

  before(function (done) {
    client.listen(PORT, done);
  });

  it('should download raw image', function (done) {
    fs.readFile(path.join(__dirname, 'image.jpg'), function (err, data) {
      var expectedFile = data;
      var url = 'http://127.0.0.1:' + PORT + '/img/raw/' + prefix + '/' + uid + '/image.jpg';

      request(url, function (err, res, body) {
        assert.ifError(err);
        assert.equal(200, res.statusCode);
        assert.equal(expectedFile.toString(), body.toString());
        assert.equal('image/jpeg', res.headers['content-type']);
        done();
      });
    });
  });

  it('should resize crop center image', function (done) {
    var w=50, h=50;
    gm(fs.createReadStream(path.join(__dirname, 'image.jpg')))
    .resize(w, h, '^')
    .gravity('Center')
    .crop(w, h, 0, 0)
    .toBuffer(function (err, data) {
      var expectedFile = data;
      var url = 'http://127.0.0.1:' + PORT + '/img/50x50/' + prefix + '/' + uid + '/image.jpg';

      request(url, { encoding: null }, function (err, res, body) {
        assert.ifError(err);
        assert.equal(200, res.statusCode);
        assert(expectedFile.equals(body));
        assert.equal('image/jpeg', res.headers['content-type']);
        done();
      });
    });
  });

  it('should resize within box', function (done) {
    var w=50, h=50;
    gm(fs.createReadStream(path.join(__dirname, 'image.jpg')))
    .resize(w, h)
    .toBuffer(function (err, data) {
      var expectedFile = data;
      var url = 'http://127.0.0.1:' + PORT + '/img/50-50/' + prefix + '/' + uid + '/image.jpg';

      request(url, { encoding: null }, function (err, res, body) {
        assert.ifError(err);
        assert.equal(200, res.statusCode);
        assert(expectedFile.equals(body));
        assert.equal('image/jpeg', res.headers['content-type']);
        done();
      });
    });
  });

  it('should resize but fill box', function (done) {
    var w=50, h=50;
    gm(fs.createReadStream(path.join(__dirname, 'image.jpg')))
    .resize(w, h, '^')
    .toBuffer(function (err, data) {
      var expectedFile = data;
      var url = 'http://127.0.0.1:' + PORT + '/img/50+50/' + prefix + '/' + uid + '/image.jpg';

      request(url, { encoding: null }, function (err, res, body) {
        assert.ifError(err);
        assert.equal(200, res.statusCode);
        assert(expectedFile.equals(body));
        assert.equal('image/jpeg', res.headers['content-type']);
        done();
      });
    });
  });

  it('should return max-age header', function (done) {
    var url = 'http://127.0.0.1:' + PORT + '/img/50+50/' + prefix + '/' + uid + '/image.jpg';

    request(url, { encoding: null }, function (err, res, body) {
      assert.ifError(err);
      assert.equal(200, res.statusCode);
      assert.equal('public, max-age=' + maxAge, res.headers['cache-control']);
      assert.equal('image/jpeg', res.headers['content-type']);
      done();
    });
  });

  it('should return 404 for unknown images', function (done) {
    var url = 'http://127.0.0.1:' + PORT + '/img/50+50/xxx/xxx/image.jpg';

    request(url, function (err, res, body) {
      assert.ifError(err);
      assert.equal(403, res.statusCode, 's3 returns 403 for unknown files');
      done();
    });
  });

});
