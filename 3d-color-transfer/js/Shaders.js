function normalTexGenVertexShader() {
  return (`
    varying vec3 vColor;

    void main() {
      vec2 pos = vec2(uv.x, 1.0 - uv.y);
      pos =  (pos * 2.0) - 1.0;

      vec3 n = normalize( normalMatrix * normal );
      vColor = (n + 1.0) / 2.0;

      gl_Position = vec4(pos, 0.0, 1.0);
    }
  `);
}

function colorTexVertexShader(){
  return (`
    varying vec2 vUV;

    void main() {
      vUV = uv;
      // vUV = vec2(uv.x, 1.0 - uv.y);

      vec2 pos = vec2(uv.x, 1.0 - uv.y);
      pos = (pos * 2.0) - 1.0;

      gl_Position = vec4(pos.xy, 0.0, 1.0);
    }
  `);
}

function colorTexFragmentShader(){
  return (`
    varying vec2 vUV;
    uniform sampler2D albedoTex;

    void main() {
      vec3 color = texture2D(albedoTex, vUV).rgb;
      gl_FragColor = vec4(color, 1.0);
    }
  `);
}

function normalVertexShader(){
  return (`
    varying vec3 vColor;

    void main() {
      vec3 n = normalize( normalMatrix * normal );
      vColor = (n + 1.0) / 2.0;

      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `);
}

function uvVertexShader(){
  return (`
  varying vec3 vColor;

  void main() {
    vColor = vec3(uv, 0.0);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
  `);
}

function blackVertexShader(){
  return (`
  varying vec3 vColor;

  void main() {
    vColor = vec3(0.0, 0.0, 0.0);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
  `);
}

function colorFragmentShader(){
  return (`
    varying vec3 vColor;

    void main() {
      gl_FragColor = vec4(vColor, 1.0);
    }
  `);
}


function colorTransferMapFragmentShader(){
  return (`
    varying vec2 vUV;

    // Input statistics
    uniform float _InputMeans[9];
    uniform float _InputStds[9];
    uniform float _InputMeansNormalL[6];
    uniform float _InputMeansNormalA[6];
    uniform float _InputMeansNormalB[6];
    uniform float _InputStdsNormalL[6];
    uniform float _InputStdsNormalA[6];
    uniform float _InputStdsNormalB[6];

    // Target statistics
    uniform float _TargetMeans[9];
    uniform float _TargetStds[9];
    uniform float _TargetMeansNormalL[6];
    uniform float _TargetMeansNormalA[6];
    uniform float _TargetMeansNormalB[6];
    uniform float _TargetStdsNormalL[6];
    uniform float _TargetStdsNormalA[6];
    uniform float _TargetStdsNormalB[6];

    // Transformations
    uniform float _TransformL[3];
    uniform float _TransformA[3];
    uniform float _TransformB[3];
    uniform float _TransformLNormal[9];
    uniform float _TransformANormal[9];
    uniform float _TransformBNormal[9];

    // Textures
    uniform sampler2D albedoTex;
    uniform sampler2D normalTex;

    // Style transfer method
    uniform int _TransferMethod;
    uniform float _SwitchTransfer;

    vec3 RGBtoLab(vec3 RGB) {
      // RGB to LMS
      float L = RGB.r * 0.3811 + RGB.g * 0.5783 + RGB.b * 0.0402;
      float M = RGB.r * 0.1967 + RGB.g * 0.7244 + RGB.b * 0.0782;
      float S = RGB.r * 0.0241 + RGB.g * 0.1288 + RGB.b * 0.8444;

      L = log(L + 0.000001) / log(10.0);
      M = log(M + 0.000001) / log(10.0);
      S = log(S + 0.000001) / log(10.0);

      // LMS to Lab
      float l = L + M + S;
      float a = L + M - 2.0 * S;
      float b = L - M;

      l = (1.0 / sqrt(3.0)) * l;
      a = (1.0 / sqrt(6.0)) * a;
      b = (1.0 / sqrt(2.0)) * b;

      return vec3(l, a, b);
    }

    vec3 LabtoRGB(vec3 Lab) {
      // Lab to LMS
      float l = (sqrt(3.0) / 3.0) * Lab.r;
      float a = (sqrt(6.0) / 6.0) * Lab.g;
      float b = (sqrt(2.0) / 2.0) * Lab.b;

      float L = l + a + b;
      float M = l + a - b;
      float S = l - 2.0 * a;

      L = pow(10.0, L);
      M = pow(10.0, M);
      S = pow(10.0, S);

      // LMS to RGB
      float R = L * 4.4678 - M * 3.5873 + S * 0.1193;
      float G = -L * 1.2186 + M * 2.3809 - S * 0.1624;
      float B = L * 0.0497 - M * 0.2439 + S * 1.2045;

      // Clamp
      R = clamp(R, 0.0, 1.0);
      G = clamp(G, 0.0, 1.0);
      B = clamp(B, 0.0, 1.0);

      return vec3(R, G, B);
    }

    vec3 IGD(vec3 col) {
      vec3 Lab = RGBtoLab(col);

      vec3 inputMeans = vec3(_InputMeans[0], _InputMeans[1], _InputMeans[2]);
      vec3 inputStds = vec3(_InputStds[0], _InputStds[1], _InputStds[2]);

      vec3 targetMeans = vec3(_TargetMeans[0], _TargetMeans[1], _TargetMeans[2]);
      vec3 targetStds = vec3(_TargetStds[0], _TargetStds[1], _TargetStds[2]);

      // Substract source mean
      Lab -= inputMeans;
      // Correct deviations (target / input)
      Lab *= (targetStds / inputStds);
      // Add target mean
      Lab += targetMeans;

      return LabtoRGB(Lab);
    }

    vec3 MGD(vec3 col) {
      vec3 Lab = RGBtoLab(col);

      float inp[3] =  float[3]( Lab.r, Lab.g, Lab.b );

      vec3 transfer = vec3(0.0, 0.0, 0.0);

      int i = 0;
      for (i = 0; i < 3; i++) {
        inp[i] -= _InputMeans[i];
      }
      for (i = 0; i < 3; i++) {
        transfer.r += _TransformL[i] * inp[i];
        transfer.g += _TransformA[i] * inp[i];
        transfer.b += _TransformB[i] * inp[i];
      }
      transfer.r += _TargetMeans[0];
      transfer.g += _TargetMeans[1];
      transfer.b += _TargetMeans[2];

      return LabtoRGB(transfer);
    }

    vec3 IGD_N(vec3 col, vec3 nor) {
      vec3 Lab = RGBtoLab(col);

      float n[6] = float[6]( abs(min(nor.x, 0.0)), max(nor.x, 0.0), abs(min(nor.y, 0.0)), max(nor.y, 0.0) , abs(min(nor.z, 0.0)), max(nor.z, 0.0) );

      float inputMeansL = n[0]*_InputMeansNormalL[0] + n[1]*_InputMeansNormalL[1] + n[2]*_InputMeansNormalL[2] + n[3]*_InputMeansNormalL[3] + n[4]*_InputMeansNormalL[4] + n[5]*_InputMeansNormalL[5];
      float inputMeansA = n[0]*_InputMeansNormalA[0] + n[1]*_InputMeansNormalA[1] + n[2]*_InputMeansNormalA[2] + n[3]*_InputMeansNormalA[3] + n[4]*_InputMeansNormalA[4] + n[5]*_InputMeansNormalA[5];
      float inputMeansB = n[0]*_InputMeansNormalB[0] + n[1]*_InputMeansNormalB[1] + n[2]*_InputMeansNormalB[2] + n[3]*_InputMeansNormalB[3] + n[4]*_InputMeansNormalB[4] + n[5]*_InputMeansNormalB[5];
      vec3 inputMeans = vec3(inputMeansL, inputMeansA, inputMeansB);

      float inputStdsL = n[0]*_InputStdsNormalL[0] + n[1]*_InputStdsNormalL[1] + n[2]*_InputStdsNormalL[2] + n[3]*_InputStdsNormalL[3] + n[4]*_InputStdsNormalL[4] + n[5]*_InputStdsNormalL[5];
      float inputStdsA = n[0]*_InputStdsNormalA[0] + n[1]*_InputStdsNormalA[1] + n[2]*_InputStdsNormalA[2] + n[3]*_InputStdsNormalA[3] + n[4]*_InputStdsNormalA[4] + n[5]*_InputStdsNormalA[5];
      float inputStdsB = n[0]*_InputStdsNormalB[0] + n[1]*_InputStdsNormalB[1] + n[2]*_InputStdsNormalB[2] + n[3]*_InputStdsNormalB[3] + n[4]*_InputStdsNormalB[4] + n[5]*_InputStdsNormalB[5];
      vec3 inputStds = vec3(inputStdsL, inputStdsA, inputStdsB);

      float targetMeansL = n[0]*_TargetMeansNormalL[0] + n[1]*_TargetMeansNormalL[1] + n[2]*_TargetMeansNormalL[2] + n[3]*_TargetMeansNormalL[3] + n[4]*_TargetMeansNormalL[4] + n[5]*_TargetMeansNormalL[5];
      float targetMeansA = n[0]*_TargetMeansNormalA[0] + n[1]*_TargetMeansNormalA[1] + n[2]*_TargetMeansNormalA[2] + n[3]*_TargetMeansNormalA[3] + n[4]*_TargetMeansNormalA[4] + n[5]*_TargetMeansNormalA[5];
      float targetMeansB = n[0]*_TargetMeansNormalB[0] + n[1]*_TargetMeansNormalB[1] + n[2]*_TargetMeansNormalB[2] + n[3]*_TargetMeansNormalB[3] + n[4]*_TargetMeansNormalB[4] + n[5]*_TargetMeansNormalB[5];
      vec3 targetMeans = vec3(targetMeansL, targetMeansA, targetMeansB);

      float targetStdsL = n[0]*_TargetStdsNormalL[0] + n[1]*_TargetStdsNormalL[1] + n[2]*_TargetStdsNormalL[2] + n[3]*_TargetStdsNormalL[3] + n[4]*_TargetStdsNormalL[4] + n[5]*_TargetStdsNormalL[5];
      float targetStdsA = n[0]*_TargetStdsNormalA[0] + n[1]*_TargetStdsNormalA[1] + n[2]*_TargetStdsNormalA[2] + n[3]*_TargetStdsNormalA[3] + n[4]*_TargetStdsNormalA[4] + n[5]*_TargetStdsNormalA[5];
      float targetStdsB = n[0]*_TargetStdsNormalB[0] + n[1]*_TargetStdsNormalB[1] + n[2]*_TargetStdsNormalB[2] + n[3]*_TargetStdsNormalB[3] + n[4]*_TargetStdsNormalB[4] + n[5]*_TargetStdsNormalB[5];
      vec3 targetStds = vec3(targetStdsL, targetStdsA, targetStdsB);

      // Substract source mean
      Lab -= inputMeans;
      // Correct standard deviation (target / input)
      Lab *= (targetStds / inputStds);
      // Add target mean
      Lab += targetMeans;

      return LabtoRGB(Lab);
    }

    vec3 MGD_N(vec3 col, vec3 nor) {
      vec3 Lab = RGBtoLab(col);

      int dim = 9;
      float inp[9] = float[9]( Lab.r, Lab.g, Lab.b, abs(min(nor.x, 0.0)), max(nor.x, 0.0), abs(min(nor.y, 0.0)), max(nor.y, 0.0) , abs(min(nor.z, 0.0)), max(nor.z, 0.0) );

      vec3 transfer = vec3(0.0, 0.0, 0.0);

      int i = 0;
      for (i = 0; i < dim; i++) {
        inp[i] -= _InputMeans[i];
      }

      for (i = 0; i < dim; i++) {
        transfer.r += _TransformLNormal[i] * inp[i];
        transfer.g += _TransformANormal[i] * inp[i];
        transfer.b += _TransformBNormal[i] * inp[i];
      }

      transfer.r += _TargetMeans[0];
      transfer.g += _TargetMeans[1];
      transfer.b += _TargetMeans[2];

      return LabtoRGB(transfer);
    }


    void main () {
      // Albedo comes from a texture
      vec3 c = texture2D(albedoTex, vUV).rgb;

      vec3 n = texture2D(normalTex, vec2(vUV.x, 1.0 - vUV.y)).rgb;
      n.r = (n.r * 2.0) - 1.0;
      n.g = (n.g * 2.0) - 1.0;
      n.b = (n.b * 2.0) - 1.0;

      // Color transfer
      vec3 transfer = vec3(0.0, 0.0, 0.0);
      if (_TransferMethod == 0) {
        transfer = IGD(c);
      }
      else if (_TransferMethod == 1) {
        transfer = MGD(c);
      }
      else if (_TransferMethod == 2) {
        transfer = IGD_N(c, n);
      }
      else if (_TransferMethod == 3) {
        transfer = MGD_N(c, n);
      }
      else {
        transfer = c;
      }
      vec3 color = (_SwitchTransfer * transfer) + ((1.0 - _SwitchTransfer) * c);

      gl_FragColor = vec4(color, 1.0);
    }
  `);
}
