# Framer 

[![build status](https://secure.travis-ci.org/mbrevoort/framer.png)](http://travis-ci.org/mbrevoort/framer)

Framer is a simple, dynamic file proxy and photo resizing http server intended to be behind an http cache or act as a CDN root server. Framer accepts uploads and stores it's files in Amazon S3.

Framer does not cache anything itself but rather sets a max-age Cache-Control header so the browser or caching proxy should act appropriately.

Framer keeps the files it manages in S3 side-stepping the burden of managing, syncronizing and backing files across instances essentially making the instances stateless.

## Usage

Let's cut to the chase. Look in the example directory at `server.js` for a working example.

### Installing

```
npm install framer
```

# Uploading

Framer accepts multipart uploads. It takes the raw file an streams it into your S3 bucket.

```
// configure, passing an optional authHandler function to handle upload 
// authorization. If ommitting, any client can upload unauthenticated
var handleUpload = framer.handleUpload({
  authHandler: function (authValue, cb) {
    // check if authorization value is valid, if so execute callback 
    // without an error and pass along a user identifier to prefix
    // the path of the location to store the image so that you know
    // who owns which images and perhaps authorization can be applied
    // this way in the future
    var userId = userIdFromToken(authValue);
    if (userId)
      cb(null, userId);
    else
      cb(new Error('unauthorized));
  }
});

if (req.url === '/upload' && req.headers['content-type']) {
  handleUpload(req, res);
}
```

The result of a successful upload will be an `application/json` response with a `uri` property containing the relative URI of the new resource. *Note*: this doesn't include the protocol, host or path prefix you may use to serve the file. For example:

```
{
    "statusCode": 200,
    "uriSuffix": "/raw/c84d9b70-caca-11e2-8e30-ab79663612ac/image.jpg"
}
```

If the upload fails, the respons will look something like this:

```
{
    "statusCode": 403,
    "error": "some ugly error message"
}
```

# Serving

Once uploaded, the images can be served from the result URL. Look at the example
to more easily understand how to use it. Basically you would wire it up like this:

```
// configure
var serveImage = framer.serveImage({ prefix: '/img', cacheMaxAge: 3600 });
var serveFile = framer.serveFile({ prefix: '/file', cacheMaxAge: 3600 });

// handle a request: 
if (req.url.indexOf('/img/') === 0) serveImage(req, res);
else if (req.url.indexOf('/file/') === 0) serveImage(req, res);
```

## Serving Images

Framer provides a simple API for resizing images on the fly to suite your needs.
This is helpful when you need multiple sizes or an image, and it's not practical
to generate all of the sizes up front.

The most useful is scale, center and crop. For example, let's say you have need
to render 100x100 thumbnails of images but that have different dimensions and size.
To scale a 1200x800 image to be a 100x100 square without changing the aspect ratio,
we do this in two stages. First we scale the height to 100 pixels resulting in an
intermediate image that's now 150x100, then we orient to the center of the image and
and crop the width to the center 100 pixel. The resulting image is 100x100, cropping out
25 pixels from each side or 200 pixels from each size of the original image.

There are two other options for scaling images that will either result in a result that
will fit into the wxh box or fill the wxh box, resulting in images 100x67 and 150x100,
respectively if considering the example above.

Images are served by passing the request and response to the function produced by 
`serveImage`.

### Original Image

Use `raw`:

`/raw/<path_to_image>`

### Scale, Center, Crop

Use a `x` to delimit width and height:

`/100x100/<path_to_image>`

### Scale within Box

Use a `-` to delimit width and height:

`/100-100/<path_to_image>`

### Scale within Box

Use a `+` to delimit width and height:

`/100+100/<path_to_image>`


## Serving files

Other non image files may be uploaded and served as well. Files are served by passing 
the request and response to the function produced by `serveFile` without the sizing 
prefix of serveImage:

`<path_to_file>`


# Contributing

Pull request and issues are totally welcome. If you have quick questions hit me up on Twitter @mbrevoort.
