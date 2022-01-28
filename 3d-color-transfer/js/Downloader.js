/**
 * @param {string} url
 * @param {Object} options
 * @param {boolean} options.rewriteAssetURLs False by default. Set to true to replace URLs in the GLTF file with local blob URLs.
 * @param {function} options.onProgress Function called with percentage everytime progress increases.
 */
function Downloader(url, options) {
    this.url = url;
    this.options = options;
    this.progress = 0;
}

Downloader.prototype = {
    /**
     * @return {Promise} Promise that resolves with an assetmap with all assets and url of the root gltf file
     */
    download: function() {
        this.progress = 0;

        this._onProgress({
            type: 'download',
            progress: 0.0
        });

        var url = this.url;
        return new Promise(
            function(resolve, reject) {
                var assetMap = {};
                var gltfUrl = 'scene.gltf';
                this._readZip(
                  url,
                  function(e) {
                    this._onProgress({
                      type: 'download',
                      progress: e.loaded / e.total
                    });
                  }.bind(this)
                )
                .then(
                  function(entries) {
                    return this._parseZip(entries);
                  }.bind(this)
                )
                .then(function(assetMap) {
                  resolve(assetMap);
                })
                .catch(reject);
            }.bind(this)
        );
    },

    _onProgress: function(message) {
        var ZIP_PROGRESS_FACTOR = 0.5;
        var value;

        if (message.type === 'download') {
            value = message.progress * (1 - ZIP_PROGRESS_FACTOR);
        }

        if (message.type === 'zip') {
            if (message.progress < ZIP_PROGRESS_FACTOR) {
                value = ZIP_PROGRESS_FACTOR;
            }
            value = 1 * ZIP_PROGRESS_FACTOR + message.progress * ZIP_PROGRESS_FACTOR;
        }

        if (message.type === 'final') {
            value = message.progress;
        }

        value = Math.floor(100 * value);

        if (value >= this.progress) {
            this.progress = value;
            if (this.options.onProgress) {
                this.options.onProgress(this.progress);
            }
        }
    },

    _readZip: function(url, onProgress) {
        return new Promise(function(resolve, reject) {
            var reader = new zip.HttpProgressReader(url, { onProgress: onProgress });
            zip.createReader(
                reader,
                function(zipReader) {
                    zipReader.getEntries(resolve);
                },
                reject
            );
        });
    },

    _parseZip: function(entries) {
        function _parseZip(resolve, reject) {
            var url;
            var entry;
            var promises = [];
            var completedPromises = 0;
            var promise;

            for (var i = 0, l = entries.length; i < l; i++) {
                entry = entries[i];

                if (entry.directory === true) {
                    continue;
                }

                if (entry.filename.match(/\.gltf$/)) {
                    url = entry.filename;
                }

                promise = this._saveEntryToBlob(
                    entry,
                    function onProgress(currentIndex, totalIndex) {
                        this._onProgress({
                            type: 'zip',
                            progress:
                                currentIndex / totalIndex / entries.length +
                                completedPromises / entries.length
                        });
                    }.bind(this)
                );

                promise.then(function(result) {
                    completedPromises++;
                    return result;
                });

                promises.push(promise);
            }

            if (!url) {
                return reject('Can not find a .gltf file');
            }

            var blobsReady = Promise.all(promises);
            blobsReady.then(function(blobs) {
                this._onProgress({
                    type: 'final',
                    progress: 1.0
                });

                var assets = blobs.reduce(function(acc, cur) {
                    acc[cur.name] = cur.url;
                    return acc;
                }, {});

                var shouldRewriteAssetsURLs =
                    this.options &&
                    this.options.hasOwnProperty('rewriteAssetURLs') &&
                    this.options.rewriteAssetURLs === true;

                if (shouldRewriteAssetsURLs) {
                    var assetsPromise = this._rewriteAssetURLs(assets, url, blobs);
                    assetsPromise.then(function(modifiedAssets) {
                        resolve({
                            assets: assets,
                            originalAssets: Object.assign({}, assets),
                            modifiedAssets: modifiedAssets,
                            url: url
                        });
                    });
                } else {
                    resolve({
                        assets: assets,
                        originalAssets: Object.assign({}, assets),
                        modifiedAssets: null,
                        url: url
                    });
                }
            }.bind(this));
        }

        return new Promise(_parseZip.bind(this));
    },

    _rewriteAssetURLs: function(assets, gltfPath, blobs) {
        return new Promise(function(resolve, reject) {
            var newAssets = Object.assign({}, assets);
            var reader = new FileReader();

            var gltfBlob = blobs.reduce(function(acc, cur){
                if (cur.name === gltfPath) {
                    return cur;
                }
                return acc;
            }, null);

            if (!gltfBlob) {
                return reject('Cannot rewrite glTF (glTF not found)');
            }

            reader.onload = function() {
                try {
                    var json = JSON.parse(reader.result);

                    // Replace original buffers and images by blob URLs
                    if (json.hasOwnProperty('buffers')) {
                        for (var i = 0; i < json.buffers.length; i++) {
                            json.buffers[i].uri = newAssets[json.buffers[i].uri];
                        }
                    }

                    if (json.hasOwnProperty('images')) {
                        for (var i = 0; i < json.images.length; i++) {
                            json.images[i].uri = newAssets[json.images[i].uri];
                        }
                    }

                    var fileContent = JSON.stringify(json, null, 2);
                    var updatedBlob = new Blob([fileContent], { type: 'text/plain' });
                    var gltfBlobUrl = window.URL.createObjectURL(updatedBlob);
                    newAssets[gltfPath] = gltfBlobUrl;
                    resolve(newAssets);
                } catch (e) {
                    reject('Cannot parse glTF file', e);
                }
            };
            reader.readAsText(gltfBlob.blob);
        });
    },

    _saveEntryToBlob: function(entry, onProgress) {
        return new Promise(function(resolve, reject) {
            entry.getData(
                new zip.BlobWriter('text/plain'),
                function onEnd(data) {
                    var url = window.URL.createObjectURL(data);
                    resolve({
                        name: entry.filename,
                        url: url,
                        blob: data
                    });
                },
                onProgress
            );
        });
    }
};



// // Download zip archive of Gltf model
// function downloadModel(viewer, url, callback) {
//   var reader = new zip.HttpReader(url);
//
//   zip.createReader(reader,
//     function(zipReader) {
//       zipReader.getEntries(function(entries) {
//         // console.log(entries);
//
//         for (var i in entries) {
//           if (entries[i].filename == 'scene.gltf') {
//             entries[i].getData(new zip.TextWriter(), function(text) {
//               viewer.sceneFileContent = text;
//               parseBlob(viewer, entries, zipReader, 0, function(){callback(null);});
//             });
//           }
//         }
//       });
//     },
//     function(error) {
//       callback(error);
//     }
//   );
// }
//
// function parseBlob(viewer, entries, zipReader, idE, callback) {
//   if(idE < entries.length){
//     entries[idE].getData(new zip.BlobWriter('text/plain'), function(data) {
//       var url = window.URL.createObjectURL(data);
//
//       viewer.assetMap[entries[idE].filename] = url;
//       parseBlob(viewer, entries, zipReader, idE+1, function(){callback(null);});
//     });
//   }
//   else {
//     zipReader.close();
//     loadModelData(viewer, function(){callback(null);});
//   }
// }
//
// // Load the gltf model
// function loadModelData(viewer, callback) {
//   var json = JSON.parse(viewer.sceneFileContent);
//   if (json.hasOwnProperty('buffers')) {
//     for (var i = 0; i < json.buffers.length; i++) {
//       json.buffers[i].uri = viewer.assetMap[json.buffers[i].uri];
//     }
//   }
//   if (json.hasOwnProperty('images')) {
//     for (var i = 0; i < json.images.length; i++) {
//       json.images[i].uri = viewer.assetMap[json.images[i].uri];
//     }
//   }
//
//   viewer.sceneFileContent = JSON.stringify(json, null, 2);
//   var updatedBlob = new Blob([viewer.sceneFileContent], { type: 'text/plain' });
//   viewer.sceneURL = window.URL.createObjectURL(updatedBlob);
//
//   loadGltf(viewer, function(){callback(null);});
// }
//
// function loadGltf (viewer, callback) {
//   clearScene(viewer);
//
//   var loader = new THREE.GLTFLoader();
//   var url = viewer.sceneURL;
//
//   loader.load(
//     url,
//     function(gltf) {
//       // console.log(gltf);
//       viewer.scene.add(gltf.scene);
//
//       //Normalize scene scale
//       var TARGET_SIZE = 5;
//       var bbox = new THREE.Box3().setFromObject(gltf.scene);
//       var maxSide = Math.max(
//         bbox.max.x - bbox.min.x,
//         bbox.max.y - bbox.min.y,
//         bbox.max.z - bbox.min.z
//       );
//       var ratio = TARGET_SIZE / maxSide;
//       gltf.scene.scale.set(ratio, ratio, ratio);
//
//       //Center scene
//       var centerX = bbox.min.x * ratio * -1 - (bbox.max.x - bbox.min.x) / 2 * ratio;
//       var centerY = bbox.min.y * ratio * -1;
//       var centerZ = bbox.min.z * ratio * -1 - (bbox.max.z - bbox.min.z) / 2 * ratio;
//       gltf.scene.translateX(centerX);
//       gltf.scene.translateY(centerY);
//       gltf.scene.translateZ(centerZ);
//
//       //Update materials with env
//       // if (ThreeViewer.environment) {
//       //     gltf.scene.traverse(function(node) {
//       //         if (node.material && 'envMap' in node.material) {
//       //             node.material.envMap = ThreeViewer.environment;
//       //             node.material.needsUpdate = true;
//       //         }
//       //     });
//       // }
//
//       callback(null);
//     },
//     undefined,
//     function(error) {
//       callback(error);
//     }
//   );
// }
//
// function clearScene(viewer) {
//   for (var i = 0, l = viewer.scene.children.length; i < l; i++) {
//     if (viewer.scene.children[i].name === 'OSG_Scene') {
//       viewer.scene.remove(viewer.scene.children[i]);
//     }
//   }
// }
