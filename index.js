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
    opts.prefix = opts.prefix || "";

    var makePublicReadable = opts.makePublicReadable || false
      , log = opts.log || function (){}
      , prefix = opts.prefix || ""
      , authHandler = opts.authHandler;

    return function (req, res, callback) {
      callback = callback === undefined ? null : callback;

      var acceptHeader = req.headers.accept;
      var isTypeHtml = (/text\/html/).test(acceptHeader);
      var isTypeText = (/text\/text/).test(acceptHeader);
      var contentType = 'application/json';
      
      if(isTypeHtml) contentType = 'text/html';
      else if(isTypeText) contentType = 'text/text';
      

      var headers = {}
        , form = new multiparty.Form()
        , batch = new Batch();

      if (makePublicReadable) headers['x-amz-acl'] = 'public-read';

      var onUnexpectedEnd = function () {
        self._handleError(500, res, new Error('incomplete upload'));
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
          , type = mime.lookup(destPath)
          ;

        headers['Content-Length'] = part.byteCount;
        headers['Content-Type'] = type;

        self._s3Client.putStream(part, destPath, headers, function (err, s3Response) {
          if (err) {
            if(callback){
              callback(err, s3Response);
            } else {
              res.writeHead(500, {'content-type': 'application/json'});
              res.end(JSON.stringify({ statusCode: 500, error: err.toString() }));  
            }
            return;
          }

          res.writeHead(res.statusCode, {'content-type': contentType});
          if (s3Response.statusCode === 200) {
            if(callback){
              s3Response.custom_uri = {
                uri: prefix + '/raw' + destPath,
                type: type
              };
              
              callback(null, s3Response);
            } else {
              res.end(JSON.stringify({ statusCode: 200, uri: prefix + '/raw' + destPath, type: type }));  
            }
          }
          else {
            var bufs = [];
            s3Response.on('data', function (d){ bufs.push(d); });
            s3Response.on('end', function () {
              // just return the ugly xml body for now
              var body =Buffer.concat(bufs).toString();

              if(callback){
                callback(null, s3Response);
              }else {
                res.end(JSON.stringify({ statusCode: s3Response.statusCode, error: body }));  
              }
              
            });
          }
        });
      });

      form.on('close', onUnexpectedEnd);
      form.on('error', function(err) {
        //just log the errors for now
        console.log('multipart error: ' + err);
      });
      form.parse(req);
    };
  };

  /* Parse URL and return in parts.
  */
  function _parse_url(request){
    return require('url').parse(request.url, true);
  }

  this.serveImage = function (opts) {
    if (!opts) opts = {};
    opts.prefix = opts.prefix || "";
    opts.cacheMaxAge = opts.cacheMaxAge || 220752000; // 1year, 60*60*24*7*365


    return function (req, res) {
      var url = req.url.substring(opts.prefix.length);

      var url_parts = _parse_url(req);
      var width = url_parts.query.width;
      var height = url_parts.query.height;
      var box = url_parts.query.box;

      var parts = url.split('/');
      var sizeOptions = parts[1];
      var path = '/' + parts.slice(2).join('/');

      self._s3Client.get(path).on('response', function(s3res){
        if (opts.cacheMaxAge) {
          res.setHeader('Cache-Control', 'public, max-age=' + opts.cacheMaxAge); 
        }

        s3res.on('error', function (err) {
          self._handleError(500, res, err);
        });

        if (s3res.statusCode !== 200) {
          return self._handleError(s3res.statusCode, res, new Error('not found'));
        }
        
        res.setHeader('Content-Type', s3res.headers['content-type']);
        res.setHeader('transfer-encoding', 'chunked');
        
        if (sizeOptions === 'raw' || (!width && !height)) {
          if (s3res.headers['content-length']) {
            res.setHeader('Content-Length', s3res.headers['content-length']);
          }
          return s3res.pipe(res);
        }

        if(sizeOptions !=== 'raw'){
          self._transform(gm(s3res), width, height, box.toLowerCase())
          .stream()
          .pipe(res);
        } else {
          self._resize(gm(s3res), width, height, box.toLowerCase())
          .stream()
          .pipe(res);  
        }

        
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
        
        res.setHeader('Content-Type', s3res.headers['content-type']);
		if (s3res.headers['content-length']) {
          res.setHeader('Content-Length', s3res.headers['content-length']);
		}

        return s3res.pipe(res);
      })
      .on('error', function (err) {
          self._handleError(500, res, err);
      })
      .end();

    };
  };


  this.deleteFile = function(opts){
      if (!opts) opts = {};
      opts.prefix = opts.prefix || "";

      return function(req, res, cb) {
        cb = cb === undefined ? null : cb;

        uri = require('url').parse(req.url, true).pathname;

        self._s3Client.deleteFile(uri, function(err, s3Res){
            if(cb){
              cb(err, s3Res);
            } else {
              res.setHeader('Content-Type', s3Res.headers['content-type']);

              if(err){
                res.end(JSON.stringify({statusCode: s3Res.statusCode, message: err.toString()}));  
              } else {
                res.end(JSON.stringify({statusCode: s3Res.statusCode, message: 'File deleted.'}));    
              }
              
            }
        });
      }; // end of return function object
      
  }; // end of deleteFile

  this._handleError = function (code, res, err) {
    res.writeHead(code, {'content-type': 'application/json'});
    res.end(JSON.stringify({ statusCode: code, error: err.toString() }));
  };


  this._resize = function(obj, width, height, box){
    if(box === 'center' || box === 'fill'){
      obj.resize(width, height, '^');
    } else {
      obj.resize(width, height);
    }

    return obj;
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
