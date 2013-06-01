var assert = require('assert')
  , multiparty = require('multiparty')
  , knox = require('knox')
  , uuid = require('node-uuid')
  , mime = require('mime')
  , Batch = require('batch')
  , gm = require('gm')
  ;

var Framer = module.exports = function Framer(opts) {
  if (typeof opts !== 'object') opts = {};

  var self = this;

  assert(typeof opts.s3 === 'object', 'opts.s3 required');
  assert(typeof opts.s3.key === 'string', 'opts.s3.key required');
  assert(typeof opts.s3.secret === 'string', 'opts.s3.secret required');
  assert(typeof opts.s3.bucket === 'string', 'opts.s3.bucket required');
  opts.s3.secure = (opts.s3.secure) ? true : false;

  this._s3Client = knox.createClient(opts.s3);

  this.handleUpload = function (opts) {
    if (!opts) opts = {};
    var makePublicReadable = opts.makePublicReadable || false;
    var log = opts.log || function (){};

    var authHandler = opts.authHandler;

    return function (req, res) {
      var headers = {};

      if (makePublicReadable) headers['x-amz-acl'] = 'public-read';
      var form = new multiparty.Form();
      var batch = new Batch();

      var onUnexpectedEnd = function () {
        res.writeHead(500, {'content-type': 'text/plain'});
        res.end('incomplete upload');
      };

      batch.push(function(cb) {
        if (authHandler) {
          form.on('field', function(name, value) {
            if ( name === 'authorization') {
              authHandler(value, cb);
            }
          });
        }
        else cb(null, '');
      });

      batch.push(function(cb) {
        form.on('part', function(part) {
          if (! part.filename) return;
          cb(null, part);
        });
      });

      batch.end(function(err, results) {
        if (err) {
          return self._handleError(401, res, err);
        }

        form.removeListener('close', onUnexpectedEnd);

        var userPrefix = results[0]
          , part = results[1]
          , filename = part.filename
          , destPrefix = (userPrefix) ? '/' + userPrefix + '/' : '/'
          , destPath = encodeURI(destPrefix + uuid.v1() + '/' + filename)
          ;

        headers['Content-Length'] = part.byteCount;
        headers['Content-Type'] = mime.lookup(destPath);

        self._s3Client.putStream(part, destPath, headers, function (err, s3Response) {
          if (err) {
            res.writeHead(500, {'content-type': 'application/json'});
            res.end(JSON.stringify({ statusCode: 500, error: err.toString() }));
            return;
          }

          res.writeHead(res.statusCode, {'content-type': 'application/json'});
          if (s3Response.statusCode === 200) {
            res.end(JSON.stringify({ statusCode: 200, uriSuffix: '/raw' + destPath}));
          }
          else {
            var bufs = [];
            s3Response.on('data', function (d){ bufs.push(d); });
            s3Response.on('end', function () {
              // just return the ugly xml body for now
              var body =Buffer.concat(bufs).toString();
              res.end(JSON.stringify({ statusCode: s3Response.statusCode, error: body }));
            })

          }
        });
      });

      form.on('close', onUnexpectedEnd);
      form.parse(req);
    };
  };

  this.serveImage = function (opts) {
    if (!opts) opts = {};
    opts.prefix = opts.prefix || "";
    opts.cacheMaxAge = opts.cacheMaxAge || 220752000; // 1year, 60*60*24*7*365


    return function (req, res) {
      var url = req.url.substring(opts.prefix.length);
      //20-20 min
      //20x20 resize, center crop
      //20+20 max
      var parts = url.split('/');
      var sizeOptions = parts[1];
      var path = '/' + parts.slice(2).join('/');

      self._s3Client.get(path).on('response', function(s3res){
        if (opts.cacheMaxAge) {
          res.setHeader('Cache-Control: max-age', opts.cacheMaxAge); // 1 week
        }

        s3res.on('error', function (err) {
          self._handleError(500, res, err);
        });

        if (sizeOptions === 'raw') {
          return s3res.pipe(res);
        }

        if (s3res.statusCode !== 200) {
          return self._handleError(s3res.statusCode, res, new Error('not found'));
        }

        self._transform(gm(s3res), sizeOptions)
          .stream()
          .pipe(res);
      })
      .on('error', function (err) {
          self._handleError(500, res, err);
      })
      .end();
    };
  };

  this.serveFile = function (opts) {
    if (!opts) opts = {};
    opts.prefix = opts.prefix || "";
    opts.cacheMaxAge = opts.cacheMaxAge || 220752000; // 1year, 60*60*24*7*365


    return function (req, res) {
      var url = req.url.substring(opts.prefix.length);

      self._s3Client.get(url).on('response', function(s3res){
        if (opts.cacheMaxAge) {
          res.setHeader('Cache-Control: max-age', opts.cacheMaxAge); // 1 week
        }

        s3res.on('error', function (err) {
          self._handleError(500, res, err);
        });

        return s3res.pipe(res);
      })
      .on('error', function (err) {
          self._handleError(500, res, err);
      })
      .end();

    };
  };

  this._handleError = function (code, res, err) {
    res.writeHead(code, {'content-type': 'application/json'});
    res.end(JSON.stringify({ statusCode: code, error: err.toString() }));
  };

  this._transform = function (obj, optionsString) {
    var size, w, h;
    if (optionsString.indexOf('x') > -1) {
      size = optionsString.split('x'); w = size[0]; h = size[1];
      return obj.resize(w, h, '^').gravity('Center').crop(w, h, 0, 0);
    }
    else if (optionsString.indexOf('+') > -1) {
      size = optionsString.split('+'); w = size[0]; h = size[1];
      return obj.resize(w, h, '^');
    }
    else if (optionsString.indexOf('-') > -1) {
      size = optionsString.split('-'); w = size[0]; h = size[1];
      return obj.resize(w, h);
    }
    else {
      return obj;
    }
  };
};