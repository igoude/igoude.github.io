/**
 * @param {string} url
 * @param {Object} options
 * @param {boolean} options.rewriteAssetURLs False by default. Set to true to replace URLs in the GLTF file with local blob URLs.
 * @param {function} options.onProgress Function called with percentage everytime progress increases.
 */
function ColorTransfer(viewer, precision, options) {
    this.viewer = viewer;
    this.precision = precision;
    this.options = options;
    this.progress = 0;

    this.bufferRenderer = new THREE.WebGLRenderer();
    this.bufferRenderer.autoClear = false;

    this.bufferCamera = new THREE.PerspectiveCamera( 75, 1.0, 0.1, 1000 );

    this.bufferScene = new THREE.Scene();
    this.bufferScene.add(this.bufferCamera);

    this.normalTexGenMaterial = new THREE.ShaderMaterial( {
      uniforms: {},
      vertexShader: normalTexGenVertexShader(),
      fragmentShader: colorFragmentShader(),
      side: THREE.DoubleSide,
      depthTest: false
    });
}

ColorTransfer.prototype = {
    /**
     * @return {Promise} Promise that resolves with an assetmap with all assets and url of the root gltf file
     */
    prepare: function() {
      this.progress = 0;

      this._onProgress({
          type: 'texture',
          progress: 0.0
      });


      return new Promise(
        function(resolve, reject) {
          this._prepareTextures(function(e) {
            this._onProgress({
              type: 'texture',
              progress: e.loaded / e.total
            });
          }.bind(this))
          .then(
            function(texSceneMap){
              return this._computeStatistics(texSceneMap, function(e) {
                this._onProgress({
                  type: 'statistics',
                  progress: e.loaded / e.total
                });
              }.bind(this));
            }.bind(this))
          .then(function(stats) {
            resolve(stats);
          })
          .catch(reject);
        }.bind(this)
      );
    },

    _onProgress: function(message) {
      // return new Promise(function(resolve, reject){
        var value;

        // console.log(message.type, message.progress);
        if (message.type === 'texture') {
          value = message.progress * 0.5;
        }

        if (message.type === 'statistics') {
          value = message.progress * 0.5 + 0.5;
        }

        value = Math.floor(100 * value);

        if (value >= this.progress) {
          this.progress = value;
          if (this.options.onProgress) {
            this.options.onProgress(this.progress);
          }
        }
      // }.bind(this));
    },

    _prepareTextures: function(onProgress) {
      async function _prepareTextures(resolve, reject) {
        var texSceneMap = [];

        var nodeG = this.viewer.graph;
        var nodeS = this.viewer.scene;
        var depthG = this._findGraphDepth(nodeG, 0);
        var depthS = this._findGraphDepth(nodeS, 0);
        for(var i = depthG; i < depthS; i++){
          nodeS = nodeS.children[0];
        }

        this._parcoursGraph(nodeG, nodeS, this.viewer.materials, this.viewer.textures, texSceneMap);
        if (texSceneMap.length == 0) {
          reject("No color texture found!");
        }

        var totalTask = 0;
        for (var i = 0; i < texSceneMap.length; i++) {
          for (var j = 0; j < texSceneMap[i].nodes.length; j++) {
            totalTask += 1.0;
          }
        }
        var progression = {};
        progression.loaded = 0;
        progression.total = totalTask;

        // Place camera in the scene
        this.viewer.api.getCameraLookAt(async function(err, camera) {
          // this.bufferCamera.position.x = camera.position[0];
          // this.bufferCamera.position.y = camera.position[1];
          // this.bufferCamera.position.z = camera.position[2];
          // this.bufferCamera.lookAt(camera.target[0], camera.target[1], camera.target[2]);

          this.bufferCamera.position.x = 0.0;
          this.bufferCamera.position.y = 0.0;
          this.bufferCamera.position.z = -1.0;

          for (var i = 0; i < texSceneMap.length; i++) {
            var albedo = texSceneMap[i].albedoMaps.images.find(tex => tex.width == this.precision);

            texSceneMap[i].normalMap = new THREE.WebGLRenderTarget( albedo.width, albedo.height, { minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, depthBuffer: false});
            this.bufferRenderer.setRenderTarget(texSceneMap[i].normalMap);

            // DO THE SPECIAL RENDERING !!!
            for (var j = 0; j < texSceneMap[i].nodes.length; j++) {
              // Place mesh in the scene
              var node = texSceneMap[i].nodes[j];
              var tempObj = new THREE.Mesh( node.geometry, this.normalTexGenMaterial );
              tempObj.doubleSided = true;

              // Seems weird... coordinate system does not match with all veiwpoints :/
              node.getWorldPosition(tempObj.position);
              node.getWorldQuaternion(tempObj.quaternion);
              node.getWorldScale(tempObj.scale);

              this.bufferScene.add(tempObj);
              this.bufferRenderer.render(this.bufferScene, this.bufferCamera);
              this.bufferScene.remove(tempObj);

              // progress
              progression.loaded += 1.0;
              await new Promise(function(resolve, reject){
                setTimeout(function() {
                  onProgress(progression);
                  resolve();
                }, 5);
              });
            }

            this.bufferRenderer.setRenderTarget(null);

            var w = albedo.width;
            var h = albedo.height;
            var data = new Uint8Array( w * h * 4 );
            this.bufferRenderer.readRenderTargetPixels( texSceneMap[i].normalMap, 0, 0, w, h, data);

            // Init canvas
            var canvas = document.createElement( 'canvas' );
            canvas.width = w;
            canvas.height = h;
            var context = canvas.getContext( '2d' );

            // Copy the pixels to a 2D canvas
            var imageData = context.createImageData(w, h);
            imageData.data.set(data);
            context.putImageData(imageData, 0, 0);

            texSceneMap[i].normalImg.src = canvas.toDataURL('image/png', 1.0);
          }

          resolve(texSceneMap);
        }.bind(this));
      }

      return new Promise(_prepareTextures.bind(this));
    },

    _findGraphDepth: function(node, depth) {
      var result = depth;

      // logging node removed a "node undefined" for some reason...
      console.log(node);

      // if(node){
        if (node.children) {
          for (var i = 0; i < node.children.length; i++) {
            var d = this._findGraphDepth(node.children[i], depth+1);
            if (d > result) result = d;
          }
        }
      // }

      return result;
    },

    _parcoursGraph: function(nodeG, nodeS, materials, textures, texSceneMap) {
      if (nodeS.isMesh) {
        var materialID = nodeG.materialID;

        var struct = texSceneMap.find(s => s.matID == nodeG.materialID);

        if (struct) {
          struct.nodes.push(nodeS);
        }
        else {
          // For viewer textures (mipmap)
            var material = materials.find(mat => mat.id === materialID);

          var texUID = null;
          if (material.channels.AlbedoPBR.texture) {
            var texUID = material.channels.AlbedoPBR.texture.uid;
          } else if (material.channels.DiffusePBR.texture) {
            var texUID = material.channels.DiffusePBR.texture.uid;
          } else if (material.channels.DiffuseColor.texture) {
            var texUID = material.channels.DiffuseColor.texture.uid;
          }

          if (texUID) {
            var albedoTextures = textures.find( tex => tex.uid === texUID);

            // For scene texture
            var albedoMap = nodeS.material.map;

            struct = {
              matID: materialID,
              nodes: [nodeS],
              albedoMaps: albedoTextures, // Should keep texUID instead...
              albedoMap: albedoMap,
              normalMap: null,
              normalImg: new Image()
            }
            texSceneMap.push(struct);
          }
        }
      }

      if (nodeS.children) {
        for (var i = 0; i < nodeS.children.length; i++) {
          var newS = nodeS.children[i];
          var newG = nodeG.children.find(c => c.name == newS.name);
          if(!newG){
            newG = nodeG.children[i];
          }

          if(newS && newG){
            this._parcoursGraph(newG, newS, materials, textures, texSceneMap);
          }
        }
      }

      return;
    },


    _computeStatistics: function(texSceneMap, onProgress) {
      async function _computeStatistics(resolve, reject) {
        var stats = {};
          stats.featureMeans = zeros(9);
          stats.featureStds = zeros(9);
          stats.featureCovariance = zeros(9, 9);

          stats.featureMeansNormal = zeros(3, 6);
          stats.featureStdsNormal = zeros(3, 6);
          stats.normNormal = zeros(6);

          var stepFast = 1;
          var totalTask = 0;
          for (var i = 0; i < texSceneMap.length; i++) {
            var w = texSceneMap[i].normalMap.width;
            var h = texSceneMap[i].normalMap.height;
            totalTask += (w*h*0.01)/stepFast;
          }
          var progression = {};
          progression.loaded = 0;
          progression.total = totalTask;

          stats.nbPixel = 0.0;

          for (var k = 0; k < texSceneMap.length; k++) {
              var w = texSceneMap[k].normalMap.width;
              var h = texSceneMap[k].normalMap.height;
              var subsampling = texSceneMap[k].albedoMap.image.width / w;

              var albedo = texSceneMap[k].albedoMap.image;
              var albedoData = getImageData(albedo, subsampling);

              // Loop over the texture
              for (var i = 0; i < w; i += stepFast) {
                for (var j = 0; j < h; j += stepFast) {
                  // await this._computePixel(texSceneMap, albedoData, i, j, k, stats);

                  // Get normal value
                  var nPix = new Uint8Array( 1 * 1 * 4 );
                  this.bufferRenderer.readRenderTargetPixels( texSceneMap[k].normalMap, i, j, 1, 1, nPix);

                  // If normal exists
                  var normalExist = !(nPix[0] < 1 && nPix[1] < 1 && nPix[2] < 1);
                  if (normalExist) {
                    // Get color value
                    var cPix = getPixel(albedoData, i, j);

                    // Normalize vectors
                    var vNormal = [(nPix[0] / 255.0) * 2.0 - 1.0, (nPix[1] / 255.0) * 2.0 - 1.0, (nPix[2] / 255.0) * 2.0 - 1.0];

                    var lab = RGB2lab([cPix.r / 255.0, cPix.g / 255.0, cPix.b / 255.0,]);

                    // Process data
                    nn = [Math.abs(Math.min(vNormal[0], 0.0)), Math.max(vNormal[0], 0.0),
                    Math.abs(Math.min(vNormal[1], 0.0)), Math.max(vNormal[1], 0.0),
                    Math.abs(Math.min(vNormal[2], 0.0)), Math.max(vNormal[2], 0.0)];
                    cc = [lab[0], lab[1], lab[2]];

                    // IGD_N
                    stats.featureMeansNormal = entrywiseadd(stats.featureMeansNormal, kroneckerProduct(cc, nn));
                    cc2 = entrywisemul(cc, cc);
                    stats.featureStdsNormal = entrywiseadd(stats.featureStdsNormal, kroneckerProduct(entrywisemul(cc, cc), nn));
                    for(var t=0; t<6; t++){
                      stats.normNormal[t] += nn[t];
                    }

                    // MGD_N
                    values9D = [ cc[0], cc[1], cc[2], nn[0], nn[1], nn[2], nn[3], nn[4], nn[5] ];
                    for(var t=0; t<9; t++){
                      stats.featureMeans[t] += values9D[t];
                    }
                    stats.featureCovariance = entrywiseadd(stats.featureCovariance, kroneckerProduct(values9D, values9D));
                    stats.nbPixel += 0.01;
                  }

                  progression.loaded += 0.01;
                }
                await new Promise(function(resolve, reject){
                  setTimeout(function() {
                    onProgress(progression);
                    resolve();
                  }, 5);
                });
              }
          }

          // IGD_N normalization
          for (var i = 0; i < size(stats.featureMeansNormal)[0]; i++) {
            for (var j = 0; j < size(stats.featureMeansNormal)[1]; j++) {
              var m = get(stats.featureMeansNormal, i, j);
              var s = get(stats.featureStdsNormal, i, j);
              m /= stats.normNormal[i];
              s /= stats.normNormal[i];
              s = Math.sqrt(s - (m*m));

              // DEBUG
              if(!s) s = 0.00001;

              set(stats.featureMeansNormal, i, j, m);
              set(stats.featureStdsNormal, i, j, s);
            }
          }

          // MGD_N normalization
          for(var t=0; t<9; t++){
            stats.featureMeans[t] /= stats.nbPixel;
            stats.featureMeans[t] /= 100.0;
          }

          m2 = kroneckerProduct(stats.featureMeans, stats.featureMeans);
          for (var i = 0; i < 9; i++) {
            for (var j = 0; j < 9; j++) {
              var c = get(stats.featureCovariance, i, j);
              c /= stats.nbPixel;
              c /= 100.0;

              if (c == 0.0) { c = 1e-3; }

              c -= get(m2, i, j);
              set(stats.featureCovariance, i, j, c);
            }
            var s = get(stats.featureCovariance, i, i);
            stats.featureStds[i] = Math.sqrt(s);
          }

          resolve({
            texSceneMap: texSceneMap,
            featureMeans: stats.featureMeans,
            featureStds: stats.featureStds,
            featureCovariance: stats.featureCovariance,
            featureMeansNormal: stats.featureMeansNormal,
            featureStdsNormal: stats.featureStdsNormal
          });

      }

      return new Promise(_computeStatistics.bind(this));
    }

};
