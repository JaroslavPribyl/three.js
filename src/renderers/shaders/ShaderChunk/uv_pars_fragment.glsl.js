export default /* glsl */`
#if ( defined( USE_UV ) && ! defined( UVS_VERTEX_ONLY ) )

	varying vec2 vUv;

#ifdef USE_NORMALMAP
    varying vec2 vUvNormalMap;
#endif
#endif
`;
