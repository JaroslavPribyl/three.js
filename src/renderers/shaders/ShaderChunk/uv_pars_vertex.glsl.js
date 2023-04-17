export default /* glsl */`
#ifdef USE_UV

	#ifdef UVS_VERTEX_ONLY

		vec2 vUv;

	#else

		varying vec2 vUv;
		#ifdef USE_NORMALMAP
			varying vec2 vUvNormalMap;
    		uniform vec4 offsetRepeatNormalMap;
		#endif
	#endif

	uniform mat3 uvTransform;

#endif
`;
