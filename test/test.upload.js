var assert = require('assert')
  , fs = require('fs')
  , http = require('http')
  , path = require('path')
  , uuid = require('node-uuid')
  , request = require('request')
  , Framer = require('..')
  ;

describe('test upload', function () {

  var expectedFile = null;
  var s3Options = {
    secure: false,
    key: 'bogus',
    secret: 'bogus',
    bucket: 'bogus',
  };
  var s3Client = {
    putStream: function (part, destPath, headers, cb) {
      var response = {
        statusCode: 200
      };
      accumulateStream(part, function (err, result) {
        assert.ifError(err);
        assert(result);
        assert.equal(expectedFile.toString(), result.toString());
        cb(null, response);
      })
    }
  }

  before(function (done) {
    fs.readFile(path.join(__dirname, 'image.jpg'), function (err, data) {
      expectedFile = data;
      done();
    });
  })

  it('should take upload', function (done) {

    var framer = new Framer({
      s3: s3Options,
    });
    framer._s3Client = s3Client;
    var handleUpload = framer.handleUpload({ prefix: '/prefix' });

    var PORT = Math.ceil(Math.random()*2000 + 1024);
    var client = http.createServer(function (req, res) {
      handleUpload(req, res);
    }).listen(PORT);

    request
      .post('http://127.0.0.1:' + PORT + '/', { json: true }, function (err, res, body) {
        assert.ifError(err);
        assert.equal(200, res.statusCode);
        assert(body.uri.indexOf('/prefix/') === 0, 'uri should be prefixed with the prefix option')
        done();
      })
      .form().append("filename", fs.createReadStream(path.join(__dirname, "image.jpg")));
  });

  it('should delegate authoritation', function (done) {

    var authValue = 'foobarbaz';
    var authHandlerCalled = false;
    var authHandler = function (value, cb) {
      authHandlerCalled = true;
      assert.equal(authValue, value);
      cb(null, value);
    }
    var framer = new Framer({
      s3: s3Options
    });
    framer._s3Client = s3Client;
    var handleUpload = framer.handleUpload({ authHandler: authHandler });

    var PORT = Math.ceil(Math.random()*2000 + 1024);
    var client = http.createServer(function (req, res) {
      handleUpload(req, res);
    }).listen(PORT);

    var r = request.post('http://127.0.0.1:' + PORT + '/', function (err, res, body) {
        assert.ifError(err);
        assert.equal(200, res.statusCode);
        assert(authHandlerCalled);
        done();
      })
    var f = r.form();
    f.append("authorization", authValue)
    f.append("filename", fs.createReadStream(path.join(__dirname, "image.jpg")));
  });


  it('should reject invalid authoritation', function (done) {

    var authValue = 'foobarbaz';
    var authHandlerCalled = false;
    var authHandler = function (value, cb) {
      authHandlerCalled = true;
      cb(new Error('unauthorized'));
    }
    var framer = new Framer({
      s3: s3Options
    });
    framer._s3Client = s3Client;
    var handleUpload = framer.handleUpload({ authHandler: authHandler });

    var PORT = Math.ceil(Math.random()*2000 + 1024);
    var client = http.createServer(function (req, res) {
      handleUpload(req, res);
    }).listen(PORT);

    var r = request.post('http://127.0.0.1:' + PORT + '/', function (err, res, body) {
        assert.ifError(err);
        assert.equal(401, res.statusCode);
        assert(authHandlerCalled);
        done();
      })
    var f = r.form();
    f.append("authorization", authValue)
    f.append("filename", fs.createReadStream(path.join(__dirname, "image.jpg")));
  });

});


function accumulateStream (stream, cb) {
  var bufs = [];
  stream.on('data', function (d){ bufs.push(d); });
  stream.on('error', cb);
  stream.on('end', function (){
    var buf = Buffer.concat(bufs);
    cb(null, buf);
  })
}