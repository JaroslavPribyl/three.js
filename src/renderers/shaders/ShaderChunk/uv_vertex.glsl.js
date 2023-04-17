export default /* glsl */`
#ifdef USE_UV

	vUv = ( uvTransform * vec3( uv, 1 ) ).xy;
#ifdef USE_NORMALMAP
    vUvNormalMap = uv * offsetRepeatNormalMap.zw + offsetRepeatNormalMap.xy;
#endif

#endif
`;
