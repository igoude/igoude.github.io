////////////////////////////////////////////////////////////////////////////
// UTILS                                                                  //
////////////////////////////////////////////////////////////////////////////
function loadGltf (assetMap) {
  var scene = new THREE.Scene();
  var loader = new THREE.GLTFLoader();

  var url = assetMap.modifiedAssets["scene.gltf"];

  return new Promise( function(resolve, reject) {
    loader.load(url, function(gltf) {
        scene.add(gltf.scene);

        //Normalize scene scale
        var TARGET_SIZE = 5;
        var bbox = new THREE.Box3().setFromObject(gltf.scene);
        var maxSide = Math.max(
          bbox.max.x - bbox.min.x,
          bbox.max.y - bbox.min.y,
          bbox.max.z - bbox.min.z
        );
        var ratio = TARGET_SIZE / maxSide;
        gltf.scene.scale.set(ratio, ratio, ratio);

        //Center scene
        var centerX = bbox.min.x * ratio * -1 - (bbox.max.x - bbox.min.x) / 2 * ratio;
        var centerY = bbox.min.y * ratio * -1;
        var centerZ = bbox.min.z * ratio * -1 - (bbox.max.z - bbox.min.z) / 2 * ratio;
        gltf.scene.translateX(centerX);
        gltf.scene.translateY(centerY);
        gltf.scene.translateZ(centerZ);

        //Update materials with env
        // if (ThreeViewer.environment) {
        //     gltf.scene.traverse(function(node) {
        //         if (node.material && 'envMap' in node.material) {
        //             node.material.envMap = ThreeViewer.environment;
        //             node.material.needsUpdate = true;
        //         }
        //     });
        // }

        resolve(scene);
      },
      undefined,
      function(error) {
        reject(error);
      }
    );
  });
}


function getImageData( image, subsampling ) {
  var canvas = document.createElement( 'canvas' );
  canvas.width = image.width / subsampling;
  canvas.height = image.height / subsampling;

  var context = canvas.getContext( '2d' );
  context.drawImage( image, 0, 0, canvas.width, canvas.height );

  return context.getImageData( 0, 0, canvas.width, canvas.height );
}

function getPixel( imagedata, x, y ) {
  var position = ( x + imagedata.width * y ) * 4, data = imagedata.data;
  return { r: data[ position ], g: data[ position + 1 ], b: data[ position + 2 ], a: data[ position + 3 ] };
}

// RGB to lab
function RGB2lab(RGB) {
  // RGB to LMS
  var LMS = new Array(3);
  LMS[0] = RGB[0] * 0.3811 + RGB[1] * 0.5783 + RGB[2] * 0.0402;
  LMS[1] = RGB[0] * 0.1967 + RGB[1] * 0.7244 + RGB[2] * 0.0782;
  LMS[2] = RGB[0] * 0.0241 + RGB[1] * 0.1288 + RGB[2] * 0.8444;

  LMS[0] = Math.log10(LMS[0] + 0.000001);
  LMS[1] = Math.log10(LMS[1] + 0.000001);
  LMS[2] = Math.log10(LMS[2] + 0.000001);

  // LMS to Lab
  var lab = new Array(3);
  lab[0] = LMS[0] + LMS[1] + LMS[2];
  lab[1] = LMS[0] + LMS[1] - 2.0 * LMS[2];
  lab[2] = LMS[0] - LMS[1];

  lab[0] = (1.0 / Math.sqrt(3.0)) * lab[0];
  lab[1] = (1.0 / Math.sqrt(6.0)) * lab[1];
  lab[2] = (1.0 / Math.sqrt(2.0)) * lab[2];

  return lab;
}

// lab to RGB
function lab2RGB(lab) {
   // Lab to LMS
   var l = (Math.sqrt(3.0) / 3.0) * lab[0];
   var a = (Math.sqrt(6.0) / 6.0) * lab[1];
   var b = (Math.sqrt(2.0) / 2.0) * lab[2];

   var LMS = new Array(3);
   LMS[0] = l + a + b;
   LMS[1] = l + a - b;
   LMS[2] = l - 2.0 * a;

   // LMS to RGB
   LMS[0] = Math.pow(10.0, LMS[0]);
   LMS[1] = Math.pow(10.0, LMS[1]);
   LMS[2] = Math.pow(10.0, LMS[2]);

   var RGB = new Array(3);
   RGB[0] = LMS[0] * 4.4678 - LMS[1] * 3.5873 + LMS[2] * 0.1193;
   RGB[1] = -LMS[0] * 1.2186 + LMS[1] * 2.3809 - LMS[2] * 0.1624;
   RGB[2] = LMS[0] * 0.0497 - LMS[1] * 0.2439 + LMS[2] * 1.2045;

   return RGB;
}


// Kronecker product
function kroneckerProduct(a, b) {
  m = size(a)[0];
  n = size(b)[0];

  R = zeros(m, n);
  for(var i=0; i<m; i++){
    for(var j=0; j<n; j++){
      set(R, i, j, get(a, i) * get(b, j));
    }
  }
  return R;
}

// Pointwise addition
function entrywiseadd(a, b) {
  m = size(a)[0];
  n = size(a)[1];

  R = zeros(m, n);
  for(var i=0; i<m; i++){
    for(var j=0; j<n; j++){
      set(R, i, j, get(a, i, j) + get(b, i, j));
    }
  }
  return R;
}

// Pointwise substraction
function entrywisesub(a, b) {
  m = size(a)[0];
  n = size(a)[1];

  R = zeros(m, n);
  for(var i=0; i<m; i++){
    for(var j=0; j<n; j++){
      set(R, i, j, get(a, i, j) - get(b, i, j));
    }
  }
  return R;
}

function matrixToVector(a, i){
  n = size(a)[1];

  var R = [];
  for(var j=0; j<n; j++){
    R.push(get(a, i, j))
  }
  return R;
}

function closedFormMatrix(A, B) {
    aSqrtRootCovMat = matrixSquareRoot(A);
    aSqrtRootCovMatInv = inv(aSqrtRootCovMat);

    middleTerm = mul(mul(aSqrtRootCovMat, B), aSqrtRootCovMat);
    middleTerm = matrixSquareRoot(middleTerm);

    matrixT = mul(mul(aSqrtRootCovMatInv, middleTerm), aSqrtRootCovMatInv);

    return matrixT;
}

function matrixSquareRoot(M) {
    E = eig(M, true);
    D = diag(E.V);

    for (var i = 0; i < E.V.length; i++) {
      var sqrtValue = Math.sqrt(Math.abs(get(D, i, i)));
      if(isNaN(sqrtValue)){
        set(D, i, i, 0.0);
      } else {
        set(D, i, i, sqrtValue);
      }
    }

    sqrtRootMatrix = mul(mul(E.U, D), inv(E.U));

    return sqrtRootMatrix;
}
