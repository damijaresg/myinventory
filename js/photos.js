/* Shrinks photos before they are saved so the phone's storage does not fill up. */
(function (root) {
  'use strict';

  var FULL_SIZE = 1000;
  var THUMB_SIZE = 240;

  function loadImage(src) {
    return new Promise(function (resolve, reject) {
      var img = new Image();
      img.onload = function () { resolve(img); };
      img.onerror = function () { reject(new Error('That photo could not be opened.')); };
      img.src = src;
    });
  }

  function shrink(img, maxSide, quality) {
    var scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
    var w = Math.max(1, Math.round(img.naturalWidth * scale));
    var h = Math.max(1, Math.round(img.naturalHeight * scale));
    var canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    var ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0, w, h);
    return canvas.toDataURL('image/jpeg', quality);
  }

  /* File from the camera or photo library -> small JPEG data URL. */
  function fromFile(file) {
    var url = URL.createObjectURL(file);
    return loadImage(url).then(function (img) {
      URL.revokeObjectURL(url);
      return shrink(img, FULL_SIZE, 0.72);
    }, function (err) {
      URL.revokeObjectURL(url);
      throw err;
    });
  }

  /* Small square-ish preview used in the item list. */
  function makeThumb(dataUrl) {
    return loadImage(dataUrl).then(function (img) { return shrink(img, THUMB_SIZE, 0.7); });
  }

  root.Photos = { fromFile: fromFile, makeThumb: makeThumb, MAX_PER_ITEM: 4 };
})(window);
