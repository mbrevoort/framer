var http = require('http')
  , Framer = require('../index')
  , PORT = process.env.PORT || 3002
  , AWS_KEY = process.env.AWS_KEY || '<yours here>'
  , AWS_SECRET = process.env.AWS_SECRET || '<yours here>'
  , AWS_S3BUCKET = process.env.AWS_S3BUCKET || '<yours here>';


var framer = new Framer({
  s3: {
    secure: false,
    key: AWS_KEY,
    secret: AWS_SECRET,
    bucket: AWS_S3BUCKET
  }
});

// authHandler is a function that gets passed the value of the authorization field
// and if valid, passes along an optional value to use as a path prefix when storing
// files. This is helpful for authorization obviously and in identifying ownership of a file.
var handleUpload = framer.handleUpload({
  authHandler: function (value, cb) {
    cb(null, value);
  }
});

var serveImage = framer.serveImage({ prefix: '/img', cacheMaxAge: 3600 });
var serveFile = framer.serveFile({ prefix: '/file', cacheMaxAge: 3600 });

var server = http.createServer(function(req, res) {
  if (req.url === '/') {
    res.writeHead(200, {'content-type': 'text/html'});
    res.end(
      '<form action="/upload" enctype="multipart/form-data" method="post">'+
      '<input type="text" name="authorization"><br>'+
      '<input type="file" name="upload"><br>'+
      '<input type="submit" value="Upload">'+
      '</form>'
    );
  } else if (req.url === '/upload' && req.headers['content-type']) {
    handleUpload(req, res);
  }
  else if (req.url.indexOf('/img/') === 0) {
    serveImage(req, res);
  }
  else if (req.url.indexOf('/file/') === 0) {
    serveFile(req, res);
  }
  else {
    res.writeHead(404, {'content-type': 'applicaiton/json'});
    res.end(JSON.stringify({ statusCode: 404 }));
  }
});

server.listen(PORT, function() {
  console.info('listening on http://0.0.0.0:'+PORT+'/');
});

