import {
	Color,
	DefaultLoadingManager,
	FileLoader,
	FrontSide,
	Loader,
	LoaderUtils,
	CubeTextureLoader,
	MeshStandardMaterial,
	MeshPhongMaterial,
	RepeatWrapping,
	TextureLoader,
	Vector2,
	sRGBEncoding
} from 'three';

class TexturesCache {

	constructor() {

		this.enabled = true;
		this.textures = {};

	}

	add( key, texture ) {

		if ( this.enabled === false ) return;

		// console.log( 'TexturesCache', 'Adding key:', key );

		this.textures[ key ] = {
			texture: texture,
			observers: []
		};

	}

	addObserver( key, observer ) {

		if ( this.textures[ key ] ) {

			this.textures[ key ].observers.push( observer );

		}

	}

	loaded( fullUrl ) {

		if ( this.textures[ fullUrl ] ) {

			var observers = this.textures[ fullUrl ].observers;
			for ( var i = 0; i < observers.length; i ++ ) {

				observers[ i ].textureLoaded( this.textures[ fullUrl ].texture );

			}

			// remove the observers and key from the cache
			delete this.textures[ fullUrl ];

		}

	}

	notLoaded( fullUrl ) {

		if ( this.textures[ fullUrl ] ) {

			var observers = this.textures[ fullUrl ].observers;
			for ( var i = 0; i < observers.length; i ++ ) {

				observers[ i ].textureNotLoaded();

			}

			// remove the observers and key from the cache
			delete this.textures[ fullUrl ];

		}

	}

	get( key ) {

		if ( this.enabled === false ) return;

		return this.textures[ key ];

	}

	remove( key ) {

		delete this.textures[ key ];

	}

	clear() {

		this.textures = {};

	}

}

const texturesCache = new TexturesCache();

/**
 * Loads a Wavefront .mtl file specifying materials
 */

class MTLLoader extends Loader {

	constructor( manager ) {

		super( manager );

		this.materialCreator = null;

	}

	/**
	 * Loads and parses a MTL asset from a URL.
	 *
	 * @param {String} url - URL to the MTL file.
	 * @param {Function} [onLoad] - Callback invoked with the loaded object.
	 * @param {Function} [onProgress] - Callback for download progress.
	 * @param {Function} [onError] - Callback for download errors.
	 *
	 * @see setPath setResourcePath
	 *
	 * @note In order for relative texture references to resolve correctly
	 * you must call setResourcePath() explicitly prior to load.
	 */
	load( url, onLoad, onProgress, onError ) {

		const scope = this;

		let textBuffer = null;
		if ( this.manager.setCache && this.manager.setCache.isReady() ) {

			textBuffer = this.manager.setCache.getFileAsTextBuffer( url );

		}

		const path = ( this.path === '' ) ? LoaderUtils.extractUrlBase( url ) : this.path;

		if ( textBuffer ) {

			onLoad( scope.parse( textBuffer, path ) );

		} else {

			const loader = new FileLoader( this.manager );
			if ( url.indexOf( 'blob:' ) === - 1 ) {

				loader.setPath( this.path );

			}

			loader.setRequestHeader( this.requestHeader );
			loader.setWithCredentials( this.withCredentials );
			loader.load( url, function ( text ) {

				try {

					onLoad( scope.parse( text, path ) );

				} catch ( e ) {

					if ( onError ) {

						onError( e );

					} else {

						console.error( e );

					}

					scope.manager.itemError( url );

				}

			}, onProgress, onError );

		}

	}

	setMaterialOptions( value ) {

		this.materialOptions = value;
		return this;

	}

	/**
	 * Parses a MTL file.
	 *
	 * @param {String} text - Content of MTL file
	 * @return {MaterialCreator}
	 *
	 * @see setPath setResourcePath
	 *
	 * @note In order for relative texture references to resolve correctly
	 * you must call setResourcePath() explicitly prior to parse.
	 */
	parse( text, path ) {

		const lines = text.split( '\n' );
		let info = {};
		const delimiter_pattern = /\s+/;
		const materialsInfo = {};

		for ( let i = 0; i < lines.length; i ++ ) {

			let line = lines[ i ];
			line = line.trim();

			if ( line.length === 0 || line.charAt( 0 ) === '#' ) {

				// Blank line or comment ignore
				continue;

			}

			const pos = line.indexOf( ' ' );

			let key = ( pos >= 0 ) ? line.substring( 0, pos ) : line;
			key = key.toLowerCase();

			let value = ( pos >= 0 ) ? line.substring( pos + 1 ) : '';
			value = value.trim();

			if ( key === 'newmtl' ) {

				// New material

				info = { name: value };
				materialsInfo[ value ] = info;

			} else {

				if ( key === 'ka' || key === 'kd' || key === 'ks' || key === 'ke' ) {

					const ss = value.split( delimiter_pattern, 3 );
					info[ key ] = [ parseFloat( ss[ 0 ] ), parseFloat( ss[ 1 ] ), parseFloat( ss[ 2 ] ) ];

				} else {

					info[ key ] = value;

				}

			}

		}

		this.materialCreator = new MaterialCreator( this.resourcePath || path, this.materialOptions );
		this.materialCreator.setCrossOrigin( this.crossOrigin );
		this.materialCreator.setManager( this.manager );
		this.materialCreator.setMaterials( materialsInfo );
		return this.materialCreator;

	}

}

/**
 * Create a new MTLLoader.MaterialCreator
 * @param baseUrl - Url relative to which textures are loaded
 * @param options - Set of options on how to construct the materials
 *                  side: Which side to apply the material
 *                        FrontSide (default), THREE.BackSide, THREE.DoubleSide
 *                  wrap: What type of wrapping to apply for textures
 *                        RepeatWrapping (default), THREE.ClampToEdgeWrapping, THREE.MirroredRepeatWrapping
 *                  normalizeRGB: RGBs need to be normalized to 0-1 from 0-255
 *                                Default: false, assumed to be already normalized
 *                  ignoreZeroRGBs: Ignore values of RGBs (Ka,Kd,Ks) that are all 0's
 *                                  Default: false
 * @constructor
 */

class MaterialCreator {

	constructor( baseUrl = '', options = {} ) {

		this.baseUrl = baseUrl;
		this.options = options;
		this.materialsInfo = {};
		this.materials = {};
		this.materialsArray = [];
		this.nameLookup = {};

		this.texturesCount = 0;
		this.texturesProcessed = 0;
		this.texturesDoneCB = null;
		this.texturesProgressCB = null;
		this.texturesLoadError = false;
		this.textureLoaders = {};

		this.crossOrigin = 'anonymous';

		this.side = ( this.options.side !== undefined ) ? this.options.side : FrontSide;
		this.wrap = ( this.options.wrap !== undefined ) ? this.options.wrap : RepeatWrapping;

	}

	/**
	 * Stop all downloads
	 */
	stopAllLoaders() {

		for ( var key in this.textureLoaders ) {

			const loader = this.textureLoaders[ key ];
			loader.image.src = '';
			loader.valid = false;

		}

	}

	setCrossOrigin( value ) {

		this.crossOrigin = value;
		return this;

	}

	setManager( value ) {

		this.manager = value;

	}

	setMaterials( materialsInfo ) {

		this.materialsInfo = this.convert( materialsInfo );
		this.materials = {};
		this.materialsArray = [];
		this.nameLookup = {};
		this.texturesCount = 0;
		this.texturesProcessed = 0;
		this.texturesLoadError = false;

	}

	convert( materialsInfo ) {

		if ( ! this.options ) return materialsInfo;

		const converted = {};

		for ( const mn in materialsInfo ) {

			// Convert materials info into normalized form based on options

			const mat = materialsInfo[ mn ];

			const covmat = {};

			converted[ mn ] = covmat;

			for ( const prop in mat ) {

				let save = true;
				let value = mat[ prop ];
				const lprop = prop.toLowerCase();

				switch ( lprop ) {

					case 'kd':
					case 'ka':
					case 'ks':

						// Diffuse color (color under white light) using RGB values

						if ( this.options && this.options.normalizeRGB ) {

							value = [ value[ 0 ] / 255, value[ 1 ] / 255, value[ 2 ] / 255 ];

						}

						if ( this.options && this.options.ignoreZeroRGBs ) {

							if ( value[ 0 ] === 0 && value[ 1 ] === 0 && value[ 2 ] === 0 ) {

								// ignore

								save = false;

							}

						}

						break;

					default:

						break;

				}

				if ( save ) {

					covmat[ lprop ] = value;

				}

			}

		}

		return converted;

	}

	preload( aTexturesDoneCB, aTexturesProgressCB ) {

		if ( aTexturesDoneCB ) {

			this.texturesDoneCB = aTexturesDoneCB;

		}

		if ( aTexturesProgressCB ) {

			this.texturesProgressCB = aTexturesProgressCB;

		}

		for ( const mn in this.materialsInfo ) {

			this.create( mn );

		}

	}

	getIndex( materialName ) {

		return this.nameLookup[ materialName ];

	}

	getByName( materialName ) {

		return this.nameLookup[ materialName ];

	}

	getAsArray() {

		let index = 0;

		for ( const mn in this.materialsInfo ) {

			this.materialsArray[ index ] = this.create( mn );
			this.nameLookup[ mn ] = index;
			index ++;

		}

		return this.materialsArray;

	}

	b64toBlob_( b64Data, contentType, sliceSize ) {

		// credit: https://ourcodeworld.com/articles/read/150/how-to-create-an-image-file-from-a-base64-string-on-the-device-with-cordova
		contentType = contentType || '';
		sliceSize = sliceSize || 512;

		const byteCharacters = atob( b64Data );
		const byteArrays = [];

		for ( var offset = 0; offset < byteCharacters.length; offset += sliceSize ) {

			const slice = byteCharacters.slice( offset, offset + sliceSize );

			const byteNumbers = new Array( slice.length );
			for ( var i = 0; i < slice.length; i ++ ) {

				byteNumbers[ i ] = slice.charCodeAt( i );

			}

			const byteArray = new Uint8Array( byteNumbers );

			byteArrays.push( byteArray );

		}

		return new Blob( byteArrays, { type: contentType } );

	}

	create( materialName ) {

		if ( this.materials[ materialName ] === undefined ) {

			this.createMaterial_( materialName );

		}

		return this.materials[ materialName ];

	}

	resolveURL_( baseUrl, url ) {

		if ( typeof url !== 'string' || url === '' )
			return '';

		// Absolute URL
		if ( /^https?:\/\//i.test( url ) ) return url;

		return baseUrl + url;

	}

	createMaterial_( materialName ) {

		// Create material

		const scope = this;
		const mat = this.materialsInfo[ materialName ];
		const params = {

			name: materialName,
			side: this.side

		};

		function setMapForType( mapType, value ) {

			if ( params[ mapType ] ) return; // Keep the first encountered texture

			const texParams = scope.getTextureParams( value, params );

			if ( scope.options ) {

				switch ( scope.options.compressedTextureType ) {

					default:
						{

							texParams.url = texParams.url.replace( '.png', '.jpg' );
							const fullUrl = scope.resolveURL_( scope.baseUrl, texParams.url );
							const cache = texturesCache.get( fullUrl );
							var map = null;
							if ( cache !== undefined && cache.texture.valid ) {

								map = cache.texture;

							} else {

								map = scope.loadTexture( texParams.url, null, texturesCache.loaded.bind( texturesCache, fullUrl ),
									undefined, texturesCache.notLoaded.bind( texturesCache, fullUrl ) );
								texturesCache.add( fullUrl, map );

							}

							texturesCache.addObserver(
								fullUrl,
								scope
							);

						}

						break;

				}

			} else {

				const fullUrl = scope.resolveURL_( scope.baseUrl, texParams.url );
				const cache = texturesCache.get( fullUrl );
				if ( cache !== undefined && cache.texture.valid ) {

					map = cache.texture;

				} else {

					map = scope.loadTexture( texParams.url, null, texturesCache.loaded.bind( texturesCache, fullUrl ),
						undefined, texturesCache.notLoaded.bind( texturesCache, fullUrl ) );
					texturesCache.add( fullUrl, map );

				}

				texturesCache.addObserver(
					fullUrl,
					scope
				);

			}

			scope.texturesCount += 1;

			map.repeat.copy( texParams.scale );
			map.offset.copy( texParams.offset );

			map.wrapS = scope.wrap;
			map.wrapT = scope.wrap;

			if ( mapType === 'map' || mapType === 'emissiveMap' ) {

				map.encoding = sRGBEncoding;

			}

			params[ mapType ] = map;

		}

		for ( const prop in mat ) {

			const value = mat[ prop ];
			let n;

			if ( value === '' ) continue;

			switch ( prop.toLowerCase() ) {

				// Ns is material specular exponent

				case 'kd':

					// Diffuse color (color under white light) using RGB values

					params.color = new Color().fromArray( value ).convertSRGBToLinear();

					break;

				case 'ks':

					// Specular color (color when light is reflected from shiny surface) using RGB values
					params.specular = new Color().fromArray( value ).convertSRGBToLinear();

					break;

				case 'ke':

					// Emissive using RGB values
					params.emissive = new Color().fromArray( value ).convertSRGBToLinear();

					break;

				case 'map_kd':

					// Diffuse texture map

					setMapForType( 'map', value );

					break;

				case 'map_ao':

					// ao map
					setMapForType( 'aoMap', value );

					break;

				case 'map_ka':

					// light map
					setMapForType( 'lightMap', value );

					break;

				case 'map_ks':

					// Specular map

					setMapForType( 'specularMap', value );

					break;

				case 'map_ke':

					// Emissive map

					setMapForType( 'emissiveMap', value );

					break;

				case 'norm':

					setMapForType( 'normalMap', value );

					break;

				case 'map_bump':
				case 'bump':

					// Bump texture map

					setMapForType( 'normalMap', value );

					break;

				case 'map_d':

					// Alpha map

					setMapForType( 'alphaMap', value );
					params.transparent = true;

					break;

				case 'ns':

					// The specular exponent (defines the focus of the specular highlight)
					// A high exponent results in a tight, concentrated highlight. Ns values normally range from 0 to 1000.

					params.shininess = parseFloat( value );

					break;

				case 'd':
					n = parseFloat( value );

					if ( n < 1 ) {

						params.opacity = n;
						params.transparent = true;

					}

					break;

				case 'tr':
					n = parseFloat( value );

					if ( this.options && this.options.invertTrProperty ) n = 1 - n;

					if ( n > 0 ) {

						params.opacity = 1 - n;
						params.transparent = true;

					}

					break;

				case 'metalness':

					n = parseFloat( value );
					params.metalness = n;
					break;

				case 'roughness':

					n = parseFloat( value );
					params.roughness = n;
					break;

				default:
					break;

			}

		}

		if ( params.metalness !== undefined /* || params.transparent*/ ) {

			// remove shininess and specular from params as the MeshStandardMaterial does not have this parameter
			if ( typeof params.shininess !== 'undefined' ) {

				delete params.shininess;

			}

			if ( typeof params.specular !== 'undefined' ) {

				delete params.specular;

			}

			this.materials[ materialName ] = new MeshStandardMaterial( params );

			const metalEnvMapBase64ImageData = 'data:image/jpeg;base64,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';

			const urls = [];

			const block = metalEnvMapBase64ImageData.split( ';' );
			const dataType = block[ 0 ].split( ':' )[ 1 ];
			const realData = block[ 1 ].split( ',' )[ 1 ];

			const blob = this.b64toBlob_( realData, dataType );
			for ( var i = 0; i < 6; i ++ ) {

				urls.push( URL.createObjectURL( blob ) );

			}

			const reflectionCube = new CubeTextureLoader().load( urls );

			/*if (materialName === "glass") {
				this.materials[materialName].color = new THREE.Color(0xccddff);
				this.materials[materialName].envMap = reflectionCube;
				this.materials[materialName].envMap.mapping = THREE.CubeRefractionMapping;
			}
			else {
				this.materials[materialName].envMap = reflectionCube;
			}*/
			this.materials[ materialName ].envMap = reflectionCube;
			this.materials[ materialName ].envMapIntensity = 1.0;
			this.materials[ materialName ].reflectivity = 0.8;

		} else {

			this.materials[ materialName ] = new MeshPhongMaterial( params );

		}

		if ( this.texturesCount === 0 ) { // handle material without textures

			this.checkAllTexturesProcessed( null );

		}

		return this.materials[ materialName ];

	}

	getTextureParams( value, matParams ) {

		const texParams = {

			scale: new Vector2( 1, 1 ),
			offset: new Vector2( 0, 0 )

		 };

		const items = value.split( /\s+/ );
		let pos;

		pos = items.indexOf( '-bm' );

		if ( pos >= 0 ) {

			matParams.bumpScale = parseFloat( items[ pos + 1 ] );
			items.splice( pos, 2 );

		}

		pos = items.indexOf( '-s' );

		if ( pos >= 0 ) {

			texParams.scale.set( parseFloat( items[ pos + 1 ] ), parseFloat( items[ pos + 2 ] ) );
			items.splice( pos, 3 ); // we expect 3 parameters here!

		}

		pos = items.indexOf( '-o' );

		if ( pos >= 0 ) {

			texParams.offset.set( parseFloat( items[ pos + 1 ] ), parseFloat( items[ pos + 2 ] ) );
			items.splice( pos, 3 ); // we expect 3 parameters here!

		}

		texParams.url = items.join( ' ' ).trim();
		return texParams;

	}

	loadTexture( url, mapping, onLoad, onProgress, onError ) {

		const fullUrl = this.resolveURL_( this.baseUrl, url );

		const manager = ( this.manager !== undefined ) ? this.manager : DefaultLoadingManager;
		let loader = this.manager.getHandler( fullUrl );
		if ( loader === null ) {

			loader = new TextureLoader( manager );

		}

		if ( loader.setCrossOrigin ) loader.setCrossOrigin( this.crossOrigin );

		let imageUrl = null;
		if ( this.manager.setCache && this.manager.setCache.isReady() ) {

			const filename = url.substring( url.lastIndexOf( '/' ) !== - 1 ? url.lastIndexOf( '/' ) + 1 : 0 );
			const textureData = this.manager.setCache.getFile( filename );
			if ( textureData ) {

				const arrayBufferView = new Uint8Array( textureData );
				const blob = new Blob( [ arrayBufferView.buffer ] );
				const urlCreator = window.URL || window.webkitURL;
				imageUrl = urlCreator.createObjectURL( blob );

			}

		}

		let texture;
		if ( imageUrl ) {

			texture = loader.load( imageUrl, onLoad, onProgress, onError );

		} else {

			texture = loader.load( fullUrl, onLoad, onProgress, onError );
			this.textureLoaders[ fullUrl ] = texture;

		}

		if ( mapping !== undefined ) texture.mapping = mapping;

		texture.valid = true;
		return texture;

	}

	textureNotLoaded() {

		this.texturesProcessed = this.texturesProcessed + 1;
		// TB: here can be some error report, some other handling
		//     but we need to mark texture as downloaded to continue in loading model...
		this.texturesLoadError = true;
		this.checkAllTexturesProcessed( null );

	}

	textureLoaded( aTexture ) {

		this.texturesProcessed = this.texturesProcessed + 1;

		this.checkAllTexturesProcessed( aTexture );

	}

	getTexturesProgress() {

		if ( this.texturesCount <= 0 ) { // handle material without textures

			return 100;

		} else {

			return this.texturesProcessed / ( this.texturesCount ) * 100;

		}

	}

	checkAllTexturesProcessed( aTexture ) {

		const status = this.getTexturesProgress();

		if ( status >= 100 ) {

			if ( this.texturesProgressCB ) {

				this.texturesProgressCB( status, this.texturesLoadError, aTexture );

			}

			if ( this.texturesDoneCB ) {

				this.texturesDoneCB( this.texturesLoadError );

			}

		} else {

			if ( this.texturesProgressCB ) {

				this.texturesProgressCB( status, this.texturesLoadError, aTexture );

			}

		}

		return status;

	}

}

export { MTLLoader };
