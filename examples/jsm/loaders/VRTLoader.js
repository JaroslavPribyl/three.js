import {
	Loader,
	FileLoader
} from 'three';

/**
 * @author Jaroslav Pribyl / http://www.vertices.cz/
 */

class VRTLoader extends Loader {

	constructor( manager ) {

		super( manager );

		this.materials = null;
		this.state = {};
	}

	load( url, onLoad, onProgress, onError ) {

		const scope = this;
		const loader = new FileLoader( this.manager );
		loader.setPath( this.path );
		loader.setResponseType( 'arraybuffer' );
		loader.load( url, function ( response ) {

			onLoad( scope.parse( response ) );

		}, onProgress, onError );

	}

	loadFromBuffer( aBuffer, onLoad ) {

		onLoad( this.parse( aBuffer ) );

	}

	setPath( value ) {

		this.path = value;

	}

	setMaterials( materials ) {

		this.materials = materials;

	}

	_createParserState() {

		this.state = {
			objects: [],
			object: {},

			vertices: [],
			normals: [],
			uvs: [],

			materialLibraries: [],

			startObject: function ( name, fromDeclaration ) {

				// If the current object (initial from reset) is not from a g/o declaration in the parsed
				// file. We need to use it for the first parsed g/o to keep things in sync.
				if ( this.object && this.object.fromDeclaration === false ) {

					this.object.name = name;
					this.object.fromDeclaration = ( fromDeclaration !== false );
					return;

				}

				var previousMaterial = ( this.object && typeof this.object.currentMaterial === 'function' ? this.object.currentMaterial() : undefined );

				if ( this.object && typeof this.object._finalize === 'function' ) {

					this.object._finalize( true );

				}

				this.object = {
					name: name || '',
					fromDeclaration: ( fromDeclaration !== false ),

					geometry: {
						vertices: [],
						normals: [],
						uvs: []
					},
					materials: [],
					smooth: true,

					startMaterial: function ( name, libraries ) {

						var previous = this._finalize( false );

						// New usemtl declaration overwrites an inherited material, except if faces were declared
						// after the material, then it must be preserved for proper MultiMaterial continuation.
						if ( previous && ( previous.inherited || previous.groupCount <= 0 ) ) {

							this.materials.splice( previous.index, 1 );

						}

						var material = {
							index: this.materials.length,
							name: name || '',
							mtllib: ( Array.isArray( libraries ) && libraries.length > 0 ? libraries[ libraries.length - 1 ] : '' ),
							smooth: ( previous !== undefined ? previous.smooth : this.smooth ),
							groupStart: ( previous !== undefined ? previous.groupEnd : 0 ),
							groupEnd: - 1,
							groupCount: - 1,
							inherited: false,

							clone: function ( index ) {

								var cloned = {
									index: ( typeof index === 'number' ? index : this.index ),
									name: this.name,
									mtllib: this.mtllib,
									smooth: this.smooth,
									groupStart: 0,
									groupEnd: - 1,
									groupCount: - 1,
									inherited: false
								};
								cloned.clone = this.clone.bind( cloned );
								return cloned;

							}
						};

						this.materials.push( material );

						return material;

					},

					currentMaterial: function () {

						if ( this.materials.length > 0 ) {

							return this.materials[ this.materials.length - 1 ];

						}

						return undefined;

					},

					_finalize: function ( end ) {

						var lastMultiMaterial = this.currentMaterial();
						if ( lastMultiMaterial && lastMultiMaterial.groupEnd === - 1 ) {

							lastMultiMaterial.groupEnd = this.geometry.vertices.length / 3;
							lastMultiMaterial.groupCount = lastMultiMaterial.groupEnd - lastMultiMaterial.groupStart;
							lastMultiMaterial.inherited = false;

						}

						// Ignore objects tail materials if no face declarations followed them before a new o/g started.
						if ( end && this.materials.length > 1 ) {

							for ( var mi = this.materials.length - 1; mi >= 0; mi -- ) {

								if ( this.materials[ mi ].groupCount <= 0 ) {

									this.materials.splice( mi, 1 );

								}

							}

						}

						// Guarantee at least one empty material, this makes the creation later more straight forward.
						if ( end && this.materials.length === 0 ) {

							this.materials.push( {
								name: '',
								smooth: this.smooth
							} );

						}

						return lastMultiMaterial;

					}
				};

				// Inherit previous objects material.
				// Spec tells us that a declared material must be set to all objects until a new material is declared.
				// If a usemtl declaration is encountered while this new object is being parsed, it will
				// overwrite the inherited material. Exception being that there was already face declarations
				// to the inherited material, then it will be preserved for proper MultiMaterial continuation.

				if ( previousMaterial && previousMaterial.name && typeof previousMaterial.clone === 'function' ) {

					var declared = previousMaterial.clone( 0 );
					declared.inherited = true;
					this.object.materials.push( declared );

				}

				this.objects.push( this.object );

			},

			finalize: function () {

				if ( this.object && typeof this.object._finalize === 'function' ) {

					this.object._finalize( true );

				}

			}
		};

		this.state.startObject( '', false );

	}

	parse( response ) {

		const uintToString = function ( uintArray ) {

			const encodedString = String.fromCharCode.apply( null, uintArray ),
				decodedString = decodeURIComponent( escape( encodedString ) );
			return decodedString;

		};

		// read VERTICES magic string
		const vrtMagicStringAB = uintToString( new Uint8Array( response.slice( 0, 8 ) ) );

		// read vrt version
		const vrtVersion = new Uint32Array( response.slice( 8, 12 ) )[ 0 ];

		const mtlLibLen = new Uint32Array( response.slice( 12, 16 ) );
		const mtlLibName = uintToString( new Uint8Array( response.slice( 16, 16 + mtlLibLen[ 0 ] ) ) );

		this._createParserState();

		// mtl file
		this.state.materialLibraries.push( mtlLibName );

		var fileCursor = 16 + mtlLibLen[ 0 ];
		while ( fileCursor < response.byteLength ) {

			// read group name
			const groupNameLen = new Uint32Array( response.slice( fileCursor, fileCursor + 4 ) )[ 0 ];
			fileCursor += 4;

			const groupName = uintToString( new Uint8Array( response.slice( fileCursor, fileCursor + groupNameLen ) ) );
			this.state.startObject( groupName );
			fileCursor += groupNameLen;

			// read used material
			const usedMtlNameLen = new Uint32Array( response.slice( fileCursor, fileCursor + 4 ) )[ 0 ];
			fileCursor += 4;

			const usedMtlName = uintToString( new Uint8Array( response.slice( fileCursor, fileCursor + usedMtlNameLen ) ) );
			fileCursor += usedMtlNameLen;
			this.state.object.startMaterial( usedMtlName, this.state.materialLibraries );

			// read smoothing group
			const smoothingGroup = new Uint32Array( response.slice( fileCursor, fileCursor + 4 ) )[ 0 ];
			fileCursor += 4;
			this.state.object.smooth = ( smoothingGroup === 1 );

			const material = this.state.object.currentMaterial();
			if ( material ) {

				material.smooth = this.state.object.smooth;

			}

			// decoded drc data
			const drcDataLen = new Uint32Array( response.slice( fileCursor, fileCursor + 4 ) )[ 0 ];
			fileCursor += 4;

			const drcData = new Uint8Array( response.slice( fileCursor, fileCursor + drcDataLen ) );
			fileCursor += drcDataLen;

			// geometry
			this.state.object.geometry.compressedData = drcData;
			this.state.object.geometry.vertices = [];
			this.state.object.geometry.normals = [];
			this.state.object.geometry.uvs = [];
			this.state.object.geometry.indices = [];

		}

		this.state.finalize();

		return this;

	}

}

export { VRTLoader };
