/******/ (() => { // webpackBootstrap
/******/ 	var __webpack_modules__ = ({

/***/ "./node_modules/better-sqlite3/lib/database.js"
/*!*****************************************************!*\
  !*** ./node_modules/better-sqlite3/lib/database.js ***!
  \*****************************************************/
(module, __unused_webpack_exports, __webpack_require__) {

"use strict";

const fs = __webpack_require__(/*! fs */ "fs");
const path = __webpack_require__(/*! path */ "path");
const util = __webpack_require__(/*! ./util */ "./node_modules/better-sqlite3/lib/util.js");
const SqliteError = __webpack_require__(/*! ./sqlite-error */ "./node_modules/better-sqlite3/lib/sqlite-error.js");

let DEFAULT_ADDON;

function Database(filenameGiven, options) {
	if (new.target == null) {
		return new Database(filenameGiven, options);
	}

	// Apply defaults
	let buffer;
	if (Buffer.isBuffer(filenameGiven)) {
		buffer = filenameGiven;
		filenameGiven = ':memory:';
	}
	if (filenameGiven == null) filenameGiven = '';
	if (options == null) options = {};

	// Validate arguments
	if (typeof filenameGiven !== 'string') throw new TypeError('Expected first argument to be a string');
	if (typeof options !== 'object') throw new TypeError('Expected second argument to be an options object');
	if ('readOnly' in options) throw new TypeError('Misspelled option "readOnly" should be "readonly"');
	if ('memory' in options) throw new TypeError('Option "memory" was removed in v7.0.0 (use ":memory:" filename instead)');

	// Interpret options
	const filename = filenameGiven.trim();
	const anonymous = filename === '' || filename === ':memory:';
	const readonly = util.getBooleanOption(options, 'readonly');
	const fileMustExist = util.getBooleanOption(options, 'fileMustExist');
	const timeout = 'timeout' in options ? options.timeout : 5000;
	const verbose = 'verbose' in options ? options.verbose : null;
	const nativeBinding = 'nativeBinding' in options ? options.nativeBinding : null;

	// Validate interpreted options
	if (readonly && anonymous && !buffer) throw new TypeError('In-memory/temporary databases cannot be readonly');
	if (!Number.isInteger(timeout) || timeout < 0) throw new TypeError('Expected the "timeout" option to be a positive integer');
	if (timeout > 0x7fffffff) throw new RangeError('Option "timeout" cannot be greater than 2147483647');
	if (verbose != null && typeof verbose !== 'function') throw new TypeError('Expected the "verbose" option to be a function');
	if (nativeBinding != null && typeof nativeBinding !== 'string' && typeof nativeBinding !== 'object') throw new TypeError('Expected the "nativeBinding" option to be a string or addon object');

	// Load the native addon
	let addon;
	if (nativeBinding == null) {
		addon = DEFAULT_ADDON || (DEFAULT_ADDON = require(__webpack_require__.ab + "build/Release/better_sqlite3.node"));
	} else if (typeof nativeBinding === 'string') {
		// See <https://webpack.js.org/api/module-variables/#__non_webpack_require__-webpack-specific>
		const requireFunc = typeof require === 'function' ? eval("require") : require;
		addon = requireFunc(path.resolve(nativeBinding).replace(/(\.node)?$/, '.node'));
	} else {
		// See <https://github.com/WiseLibs/better-sqlite3/issues/972>
		addon = nativeBinding;
	}

	if (!addon.isInitialized) {
		addon.setErrorConstructor(SqliteError);
		addon.isInitialized = true;
	}

	// Make sure the specified directory exists
	if (!anonymous && !filename.startsWith('file:') && !fs.existsSync(path.dirname(filename))) {
		throw new TypeError('Cannot open database because the directory does not exist');
	}

	Object.defineProperties(this, {
		[util.cppdb]: { value: new addon.Database(filename, filenameGiven, anonymous, readonly, fileMustExist, timeout, verbose || null, buffer || null) },
		...wrappers.getters,
	});
}

const wrappers = __webpack_require__(/*! ./methods/wrappers */ "./node_modules/better-sqlite3/lib/methods/wrappers.js");
Database.prototype.prepare = wrappers.prepare;
Database.prototype.transaction = __webpack_require__(/*! ./methods/transaction */ "./node_modules/better-sqlite3/lib/methods/transaction.js");
Database.prototype.pragma = __webpack_require__(/*! ./methods/pragma */ "./node_modules/better-sqlite3/lib/methods/pragma.js");
Database.prototype.backup = __webpack_require__(/*! ./methods/backup */ "./node_modules/better-sqlite3/lib/methods/backup.js");
Database.prototype.serialize = __webpack_require__(/*! ./methods/serialize */ "./node_modules/better-sqlite3/lib/methods/serialize.js");
Database.prototype.function = __webpack_require__(/*! ./methods/function */ "./node_modules/better-sqlite3/lib/methods/function.js");
Database.prototype.aggregate = __webpack_require__(/*! ./methods/aggregate */ "./node_modules/better-sqlite3/lib/methods/aggregate.js");
Database.prototype.table = __webpack_require__(/*! ./methods/table */ "./node_modules/better-sqlite3/lib/methods/table.js");
Database.prototype.loadExtension = wrappers.loadExtension;
Database.prototype.exec = wrappers.exec;
Database.prototype.close = wrappers.close;
Database.prototype.defaultSafeIntegers = wrappers.defaultSafeIntegers;
Database.prototype.unsafeMode = wrappers.unsafeMode;
Database.prototype[util.inspect] = __webpack_require__(/*! ./methods/inspect */ "./node_modules/better-sqlite3/lib/methods/inspect.js");

module.exports = Database;


/***/ },

/***/ "./node_modules/better-sqlite3/lib/index.js"
/*!**************************************************!*\
  !*** ./node_modules/better-sqlite3/lib/index.js ***!
  \**************************************************/
(module, __unused_webpack_exports, __webpack_require__) {

"use strict";

module.exports = __webpack_require__(/*! ./database */ "./node_modules/better-sqlite3/lib/database.js");
module.exports.SqliteError = __webpack_require__(/*! ./sqlite-error */ "./node_modules/better-sqlite3/lib/sqlite-error.js");


/***/ },

/***/ "./node_modules/better-sqlite3/lib/methods/aggregate.js"
/*!**************************************************************!*\
  !*** ./node_modules/better-sqlite3/lib/methods/aggregate.js ***!
  \**************************************************************/
(module, __unused_webpack_exports, __webpack_require__) {

"use strict";

const { getBooleanOption, cppdb } = __webpack_require__(/*! ../util */ "./node_modules/better-sqlite3/lib/util.js");

module.exports = function defineAggregate(name, options) {
	// Validate arguments
	if (typeof name !== 'string') throw new TypeError('Expected first argument to be a string');
	if (typeof options !== 'object' || options === null) throw new TypeError('Expected second argument to be an options object');
	if (!name) throw new TypeError('User-defined function name cannot be an empty string');

	// Interpret options
	const start = 'start' in options ? options.start : null;
	const step = getFunctionOption(options, 'step', true);
	const inverse = getFunctionOption(options, 'inverse', false);
	const result = getFunctionOption(options, 'result', false);
	const safeIntegers = 'safeIntegers' in options ? +getBooleanOption(options, 'safeIntegers') : 2;
	const deterministic = getBooleanOption(options, 'deterministic');
	const directOnly = getBooleanOption(options, 'directOnly');
	const varargs = getBooleanOption(options, 'varargs');
	let argCount = -1;

	// Determine argument count
	if (!varargs) {
		argCount = Math.max(getLength(step), inverse ? getLength(inverse) : 0);
		if (argCount > 0) argCount -= 1;
		if (argCount > 100) throw new RangeError('User-defined functions cannot have more than 100 arguments');
	}

	this[cppdb].aggregate(start, step, inverse, result, name, argCount, safeIntegers, deterministic, directOnly);
	return this;
};

const getFunctionOption = (options, key, required) => {
	const value = key in options ? options[key] : null;
	if (typeof value === 'function') return value;
	if (value != null) throw new TypeError(`Expected the "${key}" option to be a function`);
	if (required) throw new TypeError(`Missing required option "${key}"`);
	return null;
};

const getLength = ({ length }) => {
	if (Number.isInteger(length) && length >= 0) return length;
	throw new TypeError('Expected function.length to be a positive integer');
};


/***/ },

/***/ "./node_modules/better-sqlite3/lib/methods/backup.js"
/*!***********************************************************!*\
  !*** ./node_modules/better-sqlite3/lib/methods/backup.js ***!
  \***********************************************************/
(module, __unused_webpack_exports, __webpack_require__) {

"use strict";

const fs = __webpack_require__(/*! fs */ "fs");
const path = __webpack_require__(/*! path */ "path");
const { promisify } = __webpack_require__(/*! util */ "util");
const { cppdb } = __webpack_require__(/*! ../util */ "./node_modules/better-sqlite3/lib/util.js");
const fsAccess = promisify(fs.access);

module.exports = async function backup(filename, options) {
	if (options == null) options = {};

	// Validate arguments
	if (typeof filename !== 'string') throw new TypeError('Expected first argument to be a string');
	if (typeof options !== 'object') throw new TypeError('Expected second argument to be an options object');

	// Interpret options
	filename = filename.trim();
	const attachedName = 'attached' in options ? options.attached : 'main';
	const handler = 'progress' in options ? options.progress : null;

	// Validate interpreted options
	if (!filename) throw new TypeError('Backup filename cannot be an empty string');
	if (filename === ':memory:') throw new TypeError('Invalid backup filename ":memory:"');
	if (typeof attachedName !== 'string') throw new TypeError('Expected the "attached" option to be a string');
	if (!attachedName) throw new TypeError('The "attached" option cannot be an empty string');
	if (handler != null && typeof handler !== 'function') throw new TypeError('Expected the "progress" option to be a function');

	// Make sure the specified directory exists
	await fsAccess(path.dirname(filename)).catch(() => {
		throw new TypeError('Cannot save backup because the directory does not exist');
	});

	const isNewFile = await fsAccess(filename).then(() => false, () => true);
	return runBackup(this[cppdb].backup(this, attachedName, filename, isNewFile), handler || null);
};

const runBackup = (backup, handler) => {
	let rate = 0;
	let useDefault = true;

	return new Promise((resolve, reject) => {
		setImmediate(function step() {
			try {
				const progress = backup.transfer(rate);
				if (!progress.remainingPages) {
					backup.close();
					resolve(progress);
					return;
				}
				if (useDefault) {
					useDefault = false;
					rate = 100;
				}
				if (handler) {
					const ret = handler(progress);
					if (ret !== undefined) {
						if (typeof ret === 'number' && ret === ret) rate = Math.max(0, Math.min(0x7fffffff, Math.round(ret)));
						else throw new TypeError('Expected progress callback to return a number or undefined');
					}
				}
				setImmediate(step);
			} catch (err) {
				backup.close();
				reject(err);
			}
		});
	});
};


/***/ },

/***/ "./node_modules/better-sqlite3/lib/methods/function.js"
/*!*************************************************************!*\
  !*** ./node_modules/better-sqlite3/lib/methods/function.js ***!
  \*************************************************************/
(module, __unused_webpack_exports, __webpack_require__) {

"use strict";

const { getBooleanOption, cppdb } = __webpack_require__(/*! ../util */ "./node_modules/better-sqlite3/lib/util.js");

module.exports = function defineFunction(name, options, fn) {
	// Apply defaults
	if (options == null) options = {};
	if (typeof options === 'function') { fn = options; options = {}; }

	// Validate arguments
	if (typeof name !== 'string') throw new TypeError('Expected first argument to be a string');
	if (typeof fn !== 'function') throw new TypeError('Expected last argument to be a function');
	if (typeof options !== 'object') throw new TypeError('Expected second argument to be an options object');
	if (!name) throw new TypeError('User-defined function name cannot be an empty string');

	// Interpret options
	const safeIntegers = 'safeIntegers' in options ? +getBooleanOption(options, 'safeIntegers') : 2;
	const deterministic = getBooleanOption(options, 'deterministic');
	const directOnly = getBooleanOption(options, 'directOnly');
	const varargs = getBooleanOption(options, 'varargs');
	let argCount = -1;

	// Determine argument count
	if (!varargs) {
		argCount = fn.length;
		if (!Number.isInteger(argCount) || argCount < 0) throw new TypeError('Expected function.length to be a positive integer');
		if (argCount > 100) throw new RangeError('User-defined functions cannot have more than 100 arguments');
	}

	this[cppdb].function(fn, name, argCount, safeIntegers, deterministic, directOnly);
	return this;
};


/***/ },

/***/ "./node_modules/better-sqlite3/lib/methods/inspect.js"
/*!************************************************************!*\
  !*** ./node_modules/better-sqlite3/lib/methods/inspect.js ***!
  \************************************************************/
(module) {

"use strict";

const DatabaseInspection = function Database() {};

module.exports = function inspect(depth, opts) {
	return Object.assign(new DatabaseInspection(), this);
};



/***/ },

/***/ "./node_modules/better-sqlite3/lib/methods/pragma.js"
/*!***********************************************************!*\
  !*** ./node_modules/better-sqlite3/lib/methods/pragma.js ***!
  \***********************************************************/
(module, __unused_webpack_exports, __webpack_require__) {

"use strict";

const { getBooleanOption, cppdb } = __webpack_require__(/*! ../util */ "./node_modules/better-sqlite3/lib/util.js");

module.exports = function pragma(source, options) {
	if (options == null) options = {};
	if (typeof source !== 'string') throw new TypeError('Expected first argument to be a string');
	if (typeof options !== 'object') throw new TypeError('Expected second argument to be an options object');
	const simple = getBooleanOption(options, 'simple');

	const stmt = this[cppdb].prepare(`PRAGMA ${source}`, this, true);
	return simple ? stmt.pluck().get() : stmt.all();
};


/***/ },

/***/ "./node_modules/better-sqlite3/lib/methods/serialize.js"
/*!**************************************************************!*\
  !*** ./node_modules/better-sqlite3/lib/methods/serialize.js ***!
  \**************************************************************/
(module, __unused_webpack_exports, __webpack_require__) {

"use strict";

const { cppdb } = __webpack_require__(/*! ../util */ "./node_modules/better-sqlite3/lib/util.js");

module.exports = function serialize(options) {
	if (options == null) options = {};

	// Validate arguments
	if (typeof options !== 'object') throw new TypeError('Expected first argument to be an options object');

	// Interpret and validate options
	const attachedName = 'attached' in options ? options.attached : 'main';
	if (typeof attachedName !== 'string') throw new TypeError('Expected the "attached" option to be a string');
	if (!attachedName) throw new TypeError('The "attached" option cannot be an empty string');

	return this[cppdb].serialize(attachedName);
};


/***/ },

/***/ "./node_modules/better-sqlite3/lib/methods/table.js"
/*!**********************************************************!*\
  !*** ./node_modules/better-sqlite3/lib/methods/table.js ***!
  \**********************************************************/
(module, __unused_webpack_exports, __webpack_require__) {

"use strict";

const { cppdb } = __webpack_require__(/*! ../util */ "./node_modules/better-sqlite3/lib/util.js");

module.exports = function defineTable(name, factory) {
	// Validate arguments
	if (typeof name !== 'string') throw new TypeError('Expected first argument to be a string');
	if (!name) throw new TypeError('Virtual table module name cannot be an empty string');

	// Determine whether the module is eponymous-only or not
	let eponymous = false;
	if (typeof factory === 'object' && factory !== null) {
		eponymous = true;
		factory = defer(parseTableDefinition(factory, 'used', name));
	} else {
		if (typeof factory !== 'function') throw new TypeError('Expected second argument to be a function or a table definition object');
		factory = wrapFactory(factory);
	}

	this[cppdb].table(factory, name, eponymous);
	return this;
};

function wrapFactory(factory) {
	return function virtualTableFactory(moduleName, databaseName, tableName, ...args) {
		const thisObject = {
			module: moduleName,
			database: databaseName,
			table: tableName,
		};

		// Generate a new table definition by invoking the factory
		const def = apply.call(factory, thisObject, args);
		if (typeof def !== 'object' || def === null) {
			throw new TypeError(`Virtual table module "${moduleName}" did not return a table definition object`);
		}

		return parseTableDefinition(def, 'returned', moduleName);
	};
}

function parseTableDefinition(def, verb, moduleName) {
	// Validate required properties
	if (!hasOwnProperty.call(def, 'rows')) {
		throw new TypeError(`Virtual table module "${moduleName}" ${verb} a table definition without a "rows" property`);
	}
	if (!hasOwnProperty.call(def, 'columns')) {
		throw new TypeError(`Virtual table module "${moduleName}" ${verb} a table definition without a "columns" property`);
	}

	// Validate "rows" property
	const rows = def.rows;
	if (typeof rows !== 'function' || Object.getPrototypeOf(rows) !== GeneratorFunctionPrototype) {
		throw new TypeError(`Virtual table module "${moduleName}" ${verb} a table definition with an invalid "rows" property (should be a generator function)`);
	}

	// Validate "columns" property
	let columns = def.columns;
	if (!Array.isArray(columns) || !(columns = [...columns]).every(x => typeof x === 'string')) {
		throw new TypeError(`Virtual table module "${moduleName}" ${verb} a table definition with an invalid "columns" property (should be an array of strings)`);
	}
	if (columns.length !== new Set(columns).size) {
		throw new TypeError(`Virtual table module "${moduleName}" ${verb} a table definition with duplicate column names`);
	}
	if (!columns.length) {
		throw new RangeError(`Virtual table module "${moduleName}" ${verb} a table definition with zero columns`);
	}

	// Validate "parameters" property
	let parameters;
	if (hasOwnProperty.call(def, 'parameters')) {
		parameters = def.parameters;
		if (!Array.isArray(parameters) || !(parameters = [...parameters]).every(x => typeof x === 'string')) {
			throw new TypeError(`Virtual table module "${moduleName}" ${verb} a table definition with an invalid "parameters" property (should be an array of strings)`);
		}
	} else {
		parameters = inferParameters(rows);
	}
	if (parameters.length !== new Set(parameters).size) {
		throw new TypeError(`Virtual table module "${moduleName}" ${verb} a table definition with duplicate parameter names`);
	}
	if (parameters.length > 32) {
		throw new RangeError(`Virtual table module "${moduleName}" ${verb} a table definition with more than the maximum number of 32 parameters`);
	}
	for (const parameter of parameters) {
		if (columns.includes(parameter)) {
			throw new TypeError(`Virtual table module "${moduleName}" ${verb} a table definition with column "${parameter}" which was ambiguously defined as both a column and parameter`);
		}
	}

	// Validate "safeIntegers" option
	let safeIntegers = 2;
	if (hasOwnProperty.call(def, 'safeIntegers')) {
		const bool = def.safeIntegers;
		if (typeof bool !== 'boolean') {
			throw new TypeError(`Virtual table module "${moduleName}" ${verb} a table definition with an invalid "safeIntegers" property (should be a boolean)`);
		}
		safeIntegers = +bool;
	}

	// Validate "directOnly" option
	let directOnly = false;
	if (hasOwnProperty.call(def, 'directOnly')) {
		directOnly = def.directOnly;
		if (typeof directOnly !== 'boolean') {
			throw new TypeError(`Virtual table module "${moduleName}" ${verb} a table definition with an invalid "directOnly" property (should be a boolean)`);
		}
	}

	// Generate SQL for the virtual table definition
	const columnDefinitions = [
		...parameters.map(identifier).map(str => `${str} HIDDEN`),
		...columns.map(identifier),
	];
	return [
		`CREATE TABLE x(${columnDefinitions.join(', ')});`,
		wrapGenerator(rows, new Map(columns.map((x, i) => [x, parameters.length + i])), moduleName),
		parameters,
		safeIntegers,
		directOnly,
	];
}

function wrapGenerator(generator, columnMap, moduleName) {
	return function* virtualTable(...args) {
		/*
			We must defensively clone any buffers in the arguments, because
			otherwise the generator could mutate one of them, which would cause
			us to return incorrect values for hidden columns, potentially
			corrupting the database.
		 */
		const output = args.map(x => Buffer.isBuffer(x) ? Buffer.from(x) : x);
		for (let i = 0; i < columnMap.size; ++i) {
			output.push(null); // Fill with nulls to prevent gaps in array (v8 optimization)
		}
		for (const row of generator(...args)) {
			if (Array.isArray(row)) {
				extractRowArray(row, output, columnMap.size, moduleName);
				yield output;
			} else if (typeof row === 'object' && row !== null) {
				extractRowObject(row, output, columnMap, moduleName);
				yield output;
			} else {
				throw new TypeError(`Virtual table module "${moduleName}" yielded something that isn't a valid row object`);
			}
		}
	};
}

function extractRowArray(row, output, columnCount, moduleName) {
	if (row.length !== columnCount) {
		throw new TypeError(`Virtual table module "${moduleName}" yielded a row with an incorrect number of columns`);
	}
	const offset = output.length - columnCount;
	for (let i = 0; i < columnCount; ++i) {
		output[i + offset] = row[i];
	}
}

function extractRowObject(row, output, columnMap, moduleName) {
	let count = 0;
	for (const key of Object.keys(row)) {
		const index = columnMap.get(key);
		if (index === undefined) {
			throw new TypeError(`Virtual table module "${moduleName}" yielded a row with an undeclared column "${key}"`);
		}
		output[index] = row[key];
		count += 1;
	}
	if (count !== columnMap.size) {
		throw new TypeError(`Virtual table module "${moduleName}" yielded a row with missing columns`);
	}
}

function inferParameters({ length }) {
	if (!Number.isInteger(length) || length < 0) {
		throw new TypeError('Expected function.length to be a positive integer');
	}
	const params = [];
	for (let i = 0; i < length; ++i) {
		params.push(`$${i + 1}`);
	}
	return params;
}

const { hasOwnProperty } = Object.prototype;
const { apply } = Function.prototype;
const GeneratorFunctionPrototype = Object.getPrototypeOf(function*(){});
const identifier = str => `"${str.replace(/"/g, '""')}"`;
const defer = x => () => x;


/***/ },

/***/ "./node_modules/better-sqlite3/lib/methods/transaction.js"
/*!****************************************************************!*\
  !*** ./node_modules/better-sqlite3/lib/methods/transaction.js ***!
  \****************************************************************/
(module, __unused_webpack_exports, __webpack_require__) {

"use strict";

const { cppdb } = __webpack_require__(/*! ../util */ "./node_modules/better-sqlite3/lib/util.js");
const controllers = new WeakMap();

module.exports = function transaction(fn) {
	if (typeof fn !== 'function') throw new TypeError('Expected first argument to be a function');

	const db = this[cppdb];
	const controller = getController(db, this);
	const { apply } = Function.prototype;

	// Each version of the transaction function has these same properties
	const properties = {
		default: { value: wrapTransaction(apply, fn, db, controller.default) },
		deferred: { value: wrapTransaction(apply, fn, db, controller.deferred) },
		immediate: { value: wrapTransaction(apply, fn, db, controller.immediate) },
		exclusive: { value: wrapTransaction(apply, fn, db, controller.exclusive) },
		database: { value: this, enumerable: true },
	};

	Object.defineProperties(properties.default.value, properties);
	Object.defineProperties(properties.deferred.value, properties);
	Object.defineProperties(properties.immediate.value, properties);
	Object.defineProperties(properties.exclusive.value, properties);

	// Return the default version of the transaction function
	return properties.default.value;
};

// Return the database's cached transaction controller, or create a new one
const getController = (db, self) => {
	let controller = controllers.get(db);
	if (!controller) {
		const shared = {
			commit: db.prepare('COMMIT', self, false),
			rollback: db.prepare('ROLLBACK', self, false),
			savepoint: db.prepare('SAVEPOINT `\t_bs3.\t`', self, false),
			release: db.prepare('RELEASE `\t_bs3.\t`', self, false),
			rollbackTo: db.prepare('ROLLBACK TO `\t_bs3.\t`', self, false),
		};
		controllers.set(db, controller = {
			default: Object.assign({ begin: db.prepare('BEGIN', self, false) }, shared),
			deferred: Object.assign({ begin: db.prepare('BEGIN DEFERRED', self, false) }, shared),
			immediate: Object.assign({ begin: db.prepare('BEGIN IMMEDIATE', self, false) }, shared),
			exclusive: Object.assign({ begin: db.prepare('BEGIN EXCLUSIVE', self, false) }, shared),
		});
	}
	return controller;
};

// Return a new transaction function by wrapping the given function
const wrapTransaction = (apply, fn, db, { begin, commit, rollback, savepoint, release, rollbackTo }) => function sqliteTransaction() {
	let before, after, undo;
	if (db.inTransaction) {
		before = savepoint;
		after = release;
		undo = rollbackTo;
	} else {
		before = begin;
		after = commit;
		undo = rollback;
	}
	before.run();
	try {
		const result = apply.call(fn, this, arguments);
		if (result && typeof result.then === 'function') {
			throw new TypeError('Transaction function cannot return a promise');
		}
		after.run();
		return result;
	} catch (ex) {
		if (db.inTransaction) {
			undo.run();
			if (undo !== rollback) after.run();
		}
		throw ex;
	}
};


/***/ },

/***/ "./node_modules/better-sqlite3/lib/methods/wrappers.js"
/*!*************************************************************!*\
  !*** ./node_modules/better-sqlite3/lib/methods/wrappers.js ***!
  \*************************************************************/
(__unused_webpack_module, exports, __webpack_require__) {

"use strict";

const { cppdb } = __webpack_require__(/*! ../util */ "./node_modules/better-sqlite3/lib/util.js");

exports.prepare = function prepare(sql) {
	return this[cppdb].prepare(sql, this, false);
};

exports.exec = function exec(sql) {
	this[cppdb].exec(sql);
	return this;
};

exports.close = function close() {
	this[cppdb].close();
	return this;
};

exports.loadExtension = function loadExtension(...args) {
	this[cppdb].loadExtension(...args);
	return this;
};

exports.defaultSafeIntegers = function defaultSafeIntegers(...args) {
	this[cppdb].defaultSafeIntegers(...args);
	return this;
};

exports.unsafeMode = function unsafeMode(...args) {
	this[cppdb].unsafeMode(...args);
	return this;
};

exports.getters = {
	name: {
		get: function name() { return this[cppdb].name; },
		enumerable: true,
	},
	open: {
		get: function open() { return this[cppdb].open; },
		enumerable: true,
	},
	inTransaction: {
		get: function inTransaction() { return this[cppdb].inTransaction; },
		enumerable: true,
	},
	readonly: {
		get: function readonly() { return this[cppdb].readonly; },
		enumerable: true,
	},
	memory: {
		get: function memory() { return this[cppdb].memory; },
		enumerable: true,
	},
};


/***/ },

/***/ "./node_modules/better-sqlite3/lib/sqlite-error.js"
/*!*********************************************************!*\
  !*** ./node_modules/better-sqlite3/lib/sqlite-error.js ***!
  \*********************************************************/
(module) {

"use strict";

const descriptor = { value: 'SqliteError', writable: true, enumerable: false, configurable: true };

function SqliteError(message, code) {
	if (new.target !== SqliteError) {
		return new SqliteError(message, code);
	}
	if (typeof code !== 'string') {
		throw new TypeError('Expected second argument to be a string');
	}
	Error.call(this, message);
	descriptor.value = '' + message;
	Object.defineProperty(this, 'message', descriptor);
	Error.captureStackTrace(this, SqliteError);
	this.code = code;
}
Object.setPrototypeOf(SqliteError, Error);
Object.setPrototypeOf(SqliteError.prototype, Error.prototype);
Object.defineProperty(SqliteError.prototype, 'name', descriptor);
module.exports = SqliteError;


/***/ },

/***/ "./node_modules/better-sqlite3/lib/util.js"
/*!*************************************************!*\
  !*** ./node_modules/better-sqlite3/lib/util.js ***!
  \*************************************************/
(__unused_webpack_module, exports) {

"use strict";


exports.getBooleanOption = (options, key) => {
	let value = false;
	if (key in options && typeof (value = options[key]) !== 'boolean') {
		throw new TypeError(`Expected the "${key}" option to be a boolean`);
	}
	return value;
};

exports.cppdb = Symbol();
exports.inspect = Symbol.for('nodejs.util.inspect.custom');


/***/ },

/***/ "./node_modules/electron-squirrel-startup/index.js"
/*!*********************************************************!*\
  !*** ./node_modules/electron-squirrel-startup/index.js ***!
  \*********************************************************/
(module, __unused_webpack_exports, __webpack_require__) {

var path = __webpack_require__(/*! path */ "path");
var spawn = (__webpack_require__(/*! child_process */ "child_process").spawn);
var debug = __webpack_require__(/*! debug */ "./node_modules/electron-squirrel-startup/node_modules/debug/src/index.js")('electron-squirrel-startup');
var app = (__webpack_require__(/*! electron */ "electron").app);

var run = function(args, done) {
  var updateExe = path.resolve(path.dirname(process.execPath), '..', 'Update.exe');
  debug('Spawning `%s` with args `%s`', updateExe, args);
  spawn(updateExe, args, {
    detached: true
  }).on('close', done);
};

var check = function() {
  if (process.platform === 'win32') {
    var cmd = process.argv[1];
    debug('processing squirrel command `%s`', cmd);
    var target = path.basename(process.execPath);

    if (cmd === '--squirrel-install' || cmd === '--squirrel-updated') {
      run(['--createShortcut=' + target + ''], app.quit);
      return true;
    }
    if (cmd === '--squirrel-uninstall') {
      run(['--removeShortcut=' + target + ''], app.quit);
      return true;
    }
    if (cmd === '--squirrel-obsolete') {
      app.quit();
      return true;
    }
  }
  return false;
};

module.exports = check();


/***/ },

/***/ "./node_modules/electron-squirrel-startup/node_modules/debug/src/browser.js"
/*!**********************************************************************************!*\
  !*** ./node_modules/electron-squirrel-startup/node_modules/debug/src/browser.js ***!
  \**********************************************************************************/
(module, exports, __webpack_require__) {

/**
 * This is the web browser implementation of `debug()`.
 *
 * Expose `debug()` as the module.
 */

exports = module.exports = __webpack_require__(/*! ./debug */ "./node_modules/electron-squirrel-startup/node_modules/debug/src/debug.js");
exports.log = log;
exports.formatArgs = formatArgs;
exports.save = save;
exports.load = load;
exports.useColors = useColors;
exports.storage = 'undefined' != typeof chrome
               && 'undefined' != typeof chrome.storage
                  ? chrome.storage.local
                  : localstorage();

/**
 * Colors.
 */

exports.colors = [
  'lightseagreen',
  'forestgreen',
  'goldenrod',
  'dodgerblue',
  'darkorchid',
  'crimson'
];

/**
 * Currently only WebKit-based Web Inspectors, Firefox >= v31,
 * and the Firebug extension (any Firefox version) are known
 * to support "%c" CSS customizations.
 *
 * TODO: add a `localStorage` variable to explicitly enable/disable colors
 */

function useColors() {
  // NB: In an Electron preload script, document will be defined but not fully
  // initialized. Since we know we're in Chrome, we'll just detect this case
  // explicitly
  if (typeof window !== 'undefined' && window.process && window.process.type === 'renderer') {
    return true;
  }

  // is webkit? http://stackoverflow.com/a/16459606/376773
  // document is undefined in react-native: https://github.com/facebook/react-native/pull/1632
  return (typeof document !== 'undefined' && document.documentElement && document.documentElement.style && document.documentElement.style.WebkitAppearance) ||
    // is firebug? http://stackoverflow.com/a/398120/376773
    (typeof window !== 'undefined' && window.console && (window.console.firebug || (window.console.exception && window.console.table))) ||
    // is firefox >= v31?
    // https://developer.mozilla.org/en-US/docs/Tools/Web_Console#Styling_messages
    (typeof navigator !== 'undefined' && navigator.userAgent && navigator.userAgent.toLowerCase().match(/firefox\/(\d+)/) && parseInt(RegExp.$1, 10) >= 31) ||
    // double check webkit in userAgent just in case we are in a worker
    (typeof navigator !== 'undefined' && navigator.userAgent && navigator.userAgent.toLowerCase().match(/applewebkit\/(\d+)/));
}

/**
 * Map %j to `JSON.stringify()`, since no Web Inspectors do that by default.
 */

exports.formatters.j = function(v) {
  try {
    return JSON.stringify(v);
  } catch (err) {
    return '[UnexpectedJSONParseError]: ' + err.message;
  }
};


/**
 * Colorize log arguments if enabled.
 *
 * @api public
 */

function formatArgs(args) {
  var useColors = this.useColors;

  args[0] = (useColors ? '%c' : '')
    + this.namespace
    + (useColors ? ' %c' : ' ')
    + args[0]
    + (useColors ? '%c ' : ' ')
    + '+' + exports.humanize(this.diff);

  if (!useColors) return;

  var c = 'color: ' + this.color;
  args.splice(1, 0, c, 'color: inherit')

  // the final "%c" is somewhat tricky, because there could be other
  // arguments passed either before or after the %c, so we need to
  // figure out the correct index to insert the CSS into
  var index = 0;
  var lastC = 0;
  args[0].replace(/%[a-zA-Z%]/g, function(match) {
    if ('%%' === match) return;
    index++;
    if ('%c' === match) {
      // we only are interested in the *last* %c
      // (the user may have provided their own)
      lastC = index;
    }
  });

  args.splice(lastC, 0, c);
}

/**
 * Invokes `console.log()` when available.
 * No-op when `console.log` is not a "function".
 *
 * @api public
 */

function log() {
  // this hackery is required for IE8/9, where
  // the `console.log` function doesn't have 'apply'
  return 'object' === typeof console
    && console.log
    && Function.prototype.apply.call(console.log, console, arguments);
}

/**
 * Save `namespaces`.
 *
 * @param {String} namespaces
 * @api private
 */

function save(namespaces) {
  try {
    if (null == namespaces) {
      exports.storage.removeItem('debug');
    } else {
      exports.storage.debug = namespaces;
    }
  } catch(e) {}
}

/**
 * Load `namespaces`.
 *
 * @return {String} returns the previously persisted debug modes
 * @api private
 */

function load() {
  var r;
  try {
    r = exports.storage.debug;
  } catch(e) {}

  // If debug isn't set in LS, and we're in Electron, try to load $DEBUG
  if (!r && typeof process !== 'undefined' && 'env' in process) {
    r = process.env.DEBUG;
  }

  return r;
}

/**
 * Enable namespaces listed in `localStorage.debug` initially.
 */

exports.enable(load());

/**
 * Localstorage attempts to return the localstorage.
 *
 * This is necessary because safari throws
 * when a user disables cookies/localstorage
 * and you attempt to access it.
 *
 * @return {LocalStorage}
 * @api private
 */

function localstorage() {
  try {
    return window.localStorage;
  } catch (e) {}
}


/***/ },

/***/ "./node_modules/electron-squirrel-startup/node_modules/debug/src/debug.js"
/*!********************************************************************************!*\
  !*** ./node_modules/electron-squirrel-startup/node_modules/debug/src/debug.js ***!
  \********************************************************************************/
(module, exports, __webpack_require__) {


/**
 * This is the common logic for both the Node.js and web browser
 * implementations of `debug()`.
 *
 * Expose `debug()` as the module.
 */

exports = module.exports = createDebug.debug = createDebug['default'] = createDebug;
exports.coerce = coerce;
exports.disable = disable;
exports.enable = enable;
exports.enabled = enabled;
exports.humanize = __webpack_require__(/*! ms */ "./node_modules/electron-squirrel-startup/node_modules/ms/index.js");

/**
 * The currently active debug mode names, and names to skip.
 */

exports.names = [];
exports.skips = [];

/**
 * Map of special "%n" handling functions, for the debug "format" argument.
 *
 * Valid key names are a single, lower or upper-case letter, i.e. "n" and "N".
 */

exports.formatters = {};

/**
 * Previous log timestamp.
 */

var prevTime;

/**
 * Select a color.
 * @param {String} namespace
 * @return {Number}
 * @api private
 */

function selectColor(namespace) {
  var hash = 0, i;

  for (i in namespace) {
    hash  = ((hash << 5) - hash) + namespace.charCodeAt(i);
    hash |= 0; // Convert to 32bit integer
  }

  return exports.colors[Math.abs(hash) % exports.colors.length];
}

/**
 * Create a debugger with the given `namespace`.
 *
 * @param {String} namespace
 * @return {Function}
 * @api public
 */

function createDebug(namespace) {

  function debug() {
    // disabled?
    if (!debug.enabled) return;

    var self = debug;

    // set `diff` timestamp
    var curr = +new Date();
    var ms = curr - (prevTime || curr);
    self.diff = ms;
    self.prev = prevTime;
    self.curr = curr;
    prevTime = curr;

    // turn the `arguments` into a proper Array
    var args = new Array(arguments.length);
    for (var i = 0; i < args.length; i++) {
      args[i] = arguments[i];
    }

    args[0] = exports.coerce(args[0]);

    if ('string' !== typeof args[0]) {
      // anything else let's inspect with %O
      args.unshift('%O');
    }

    // apply any `formatters` transformations
    var index = 0;
    args[0] = args[0].replace(/%([a-zA-Z%])/g, function(match, format) {
      // if we encounter an escaped % then don't increase the array index
      if (match === '%%') return match;
      index++;
      var formatter = exports.formatters[format];
      if ('function' === typeof formatter) {
        var val = args[index];
        match = formatter.call(self, val);

        // now we need to remove `args[index]` since it's inlined in the `format`
        args.splice(index, 1);
        index--;
      }
      return match;
    });

    // apply env-specific formatting (colors, etc.)
    exports.formatArgs.call(self, args);

    var logFn = debug.log || exports.log || console.log.bind(console);
    logFn.apply(self, args);
  }

  debug.namespace = namespace;
  debug.enabled = exports.enabled(namespace);
  debug.useColors = exports.useColors();
  debug.color = selectColor(namespace);

  // env-specific initialization logic for debug instances
  if ('function' === typeof exports.init) {
    exports.init(debug);
  }

  return debug;
}

/**
 * Enables a debug mode by namespaces. This can include modes
 * separated by a colon and wildcards.
 *
 * @param {String} namespaces
 * @api public
 */

function enable(namespaces) {
  exports.save(namespaces);

  exports.names = [];
  exports.skips = [];

  var split = (typeof namespaces === 'string' ? namespaces : '').split(/[\s,]+/);
  var len = split.length;

  for (var i = 0; i < len; i++) {
    if (!split[i]) continue; // ignore empty strings
    namespaces = split[i].replace(/\*/g, '.*?');
    if (namespaces[0] === '-') {
      exports.skips.push(new RegExp('^' + namespaces.substr(1) + '$'));
    } else {
      exports.names.push(new RegExp('^' + namespaces + '$'));
    }
  }
}

/**
 * Disable debug output.
 *
 * @api public
 */

function disable() {
  exports.enable('');
}

/**
 * Returns true if the given mode name is enabled, false otherwise.
 *
 * @param {String} name
 * @return {Boolean}
 * @api public
 */

function enabled(name) {
  var i, len;
  for (i = 0, len = exports.skips.length; i < len; i++) {
    if (exports.skips[i].test(name)) {
      return false;
    }
  }
  for (i = 0, len = exports.names.length; i < len; i++) {
    if (exports.names[i].test(name)) {
      return true;
    }
  }
  return false;
}

/**
 * Coerce `val`.
 *
 * @param {Mixed} val
 * @return {Mixed}
 * @api private
 */

function coerce(val) {
  if (val instanceof Error) return val.stack || val.message;
  return val;
}


/***/ },

/***/ "./node_modules/electron-squirrel-startup/node_modules/debug/src/index.js"
/*!********************************************************************************!*\
  !*** ./node_modules/electron-squirrel-startup/node_modules/debug/src/index.js ***!
  \********************************************************************************/
(module, __unused_webpack_exports, __webpack_require__) {

/**
 * Detect Electron renderer process, which is node, but we should
 * treat as a browser.
 */

if (typeof process !== 'undefined' && process.type === 'renderer') {
  module.exports = __webpack_require__(/*! ./browser.js */ "./node_modules/electron-squirrel-startup/node_modules/debug/src/browser.js");
} else {
  module.exports = __webpack_require__(/*! ./node.js */ "./node_modules/electron-squirrel-startup/node_modules/debug/src/node.js");
}


/***/ },

/***/ "./node_modules/electron-squirrel-startup/node_modules/debug/src/node.js"
/*!*******************************************************************************!*\
  !*** ./node_modules/electron-squirrel-startup/node_modules/debug/src/node.js ***!
  \*******************************************************************************/
(module, exports, __webpack_require__) {

/**
 * Module dependencies.
 */

var tty = __webpack_require__(/*! tty */ "tty");
var util = __webpack_require__(/*! util */ "util");

/**
 * This is the Node.js implementation of `debug()`.
 *
 * Expose `debug()` as the module.
 */

exports = module.exports = __webpack_require__(/*! ./debug */ "./node_modules/electron-squirrel-startup/node_modules/debug/src/debug.js");
exports.init = init;
exports.log = log;
exports.formatArgs = formatArgs;
exports.save = save;
exports.load = load;
exports.useColors = useColors;

/**
 * Colors.
 */

exports.colors = [6, 2, 3, 4, 5, 1];

/**
 * Build up the default `inspectOpts` object from the environment variables.
 *
 *   $ DEBUG_COLORS=no DEBUG_DEPTH=10 DEBUG_SHOW_HIDDEN=enabled node script.js
 */

exports.inspectOpts = Object.keys(process.env).filter(function (key) {
  return /^debug_/i.test(key);
}).reduce(function (obj, key) {
  // camel-case
  var prop = key
    .substring(6)
    .toLowerCase()
    .replace(/_([a-z])/g, function (_, k) { return k.toUpperCase() });

  // coerce string value into JS value
  var val = process.env[key];
  if (/^(yes|on|true|enabled)$/i.test(val)) val = true;
  else if (/^(no|off|false|disabled)$/i.test(val)) val = false;
  else if (val === 'null') val = null;
  else val = Number(val);

  obj[prop] = val;
  return obj;
}, {});

/**
 * The file descriptor to write the `debug()` calls to.
 * Set the `DEBUG_FD` env variable to override with another value. i.e.:
 *
 *   $ DEBUG_FD=3 node script.js 3>debug.log
 */

var fd = parseInt(process.env.DEBUG_FD, 10) || 2;

if (1 !== fd && 2 !== fd) {
  util.deprecate(function(){}, 'except for stderr(2) and stdout(1), any other usage of DEBUG_FD is deprecated. Override debug.log if you want to use a different log function (https://git.io/debug_fd)')()
}

var stream = 1 === fd ? process.stdout :
             2 === fd ? process.stderr :
             createWritableStdioStream(fd);

/**
 * Is stdout a TTY? Colored output is enabled when `true`.
 */

function useColors() {
  return 'colors' in exports.inspectOpts
    ? Boolean(exports.inspectOpts.colors)
    : tty.isatty(fd);
}

/**
 * Map %o to `util.inspect()`, all on a single line.
 */

exports.formatters.o = function(v) {
  this.inspectOpts.colors = this.useColors;
  return util.inspect(v, this.inspectOpts)
    .split('\n').map(function(str) {
      return str.trim()
    }).join(' ');
};

/**
 * Map %o to `util.inspect()`, allowing multiple lines if needed.
 */

exports.formatters.O = function(v) {
  this.inspectOpts.colors = this.useColors;
  return util.inspect(v, this.inspectOpts);
};

/**
 * Adds ANSI color escape codes if enabled.
 *
 * @api public
 */

function formatArgs(args) {
  var name = this.namespace;
  var useColors = this.useColors;

  if (useColors) {
    var c = this.color;
    var prefix = '  \u001b[3' + c + ';1m' + name + ' ' + '\u001b[0m';

    args[0] = prefix + args[0].split('\n').join('\n' + prefix);
    args.push('\u001b[3' + c + 'm+' + exports.humanize(this.diff) + '\u001b[0m');
  } else {
    args[0] = new Date().toUTCString()
      + ' ' + name + ' ' + args[0];
  }
}

/**
 * Invokes `util.format()` with the specified arguments and writes to `stream`.
 */

function log() {
  return stream.write(util.format.apply(util, arguments) + '\n');
}

/**
 * Save `namespaces`.
 *
 * @param {String} namespaces
 * @api private
 */

function save(namespaces) {
  if (null == namespaces) {
    // If you set a process.env field to null or undefined, it gets cast to the
    // string 'null' or 'undefined'. Just delete instead.
    delete process.env.DEBUG;
  } else {
    process.env.DEBUG = namespaces;
  }
}

/**
 * Load `namespaces`.
 *
 * @return {String} returns the previously persisted debug modes
 * @api private
 */

function load() {
  return process.env.DEBUG;
}

/**
 * Copied from `node/src/node.js`.
 *
 * XXX: It's lame that node doesn't expose this API out-of-the-box. It also
 * relies on the undocumented `tty_wrap.guessHandleType()` which is also lame.
 */

function createWritableStdioStream (fd) {
  var stream;
  var tty_wrap = process.binding('tty_wrap');

  // Note stream._type is used for test-module-load-list.js

  switch (tty_wrap.guessHandleType(fd)) {
    case 'TTY':
      stream = new tty.WriteStream(fd);
      stream._type = 'tty';

      // Hack to have stream not keep the event loop alive.
      // See https://github.com/joyent/node/issues/1726
      if (stream._handle && stream._handle.unref) {
        stream._handle.unref();
      }
      break;

    case 'FILE':
      var fs = __webpack_require__(/*! fs */ "fs");
      stream = new fs.SyncWriteStream(fd, { autoClose: false });
      stream._type = 'fs';
      break;

    case 'PIPE':
    case 'TCP':
      var net = __webpack_require__(/*! net */ "net");
      stream = new net.Socket({
        fd: fd,
        readable: false,
        writable: true
      });

      // FIXME Should probably have an option in net.Socket to create a
      // stream from an existing fd which is writable only. But for now
      // we'll just add this hack and set the `readable` member to false.
      // Test: ./node test/fixtures/echo.js < /etc/passwd
      stream.readable = false;
      stream.read = null;
      stream._type = 'pipe';

      // FIXME Hack to have stream not keep the event loop alive.
      // See https://github.com/joyent/node/issues/1726
      if (stream._handle && stream._handle.unref) {
        stream._handle.unref();
      }
      break;

    default:
      // Probably an error on in uv_guess_handle()
      throw new Error('Implement me. Unknown stream file type!');
  }

  // For supporting legacy API we put the FD here.
  stream.fd = fd;

  stream._isStdio = true;

  return stream;
}

/**
 * Init logic for `debug` instances.
 *
 * Create a new `inspectOpts` object in case `useColors` is set
 * differently for a particular `debug` instance.
 */

function init (debug) {
  debug.inspectOpts = {};

  var keys = Object.keys(exports.inspectOpts);
  for (var i = 0; i < keys.length; i++) {
    debug.inspectOpts[keys[i]] = exports.inspectOpts[keys[i]];
  }
}

/**
 * Enable namespaces listed in `process.env.DEBUG` initially.
 */

exports.enable(load());


/***/ },

/***/ "./node_modules/electron-squirrel-startup/node_modules/ms/index.js"
/*!*************************************************************************!*\
  !*** ./node_modules/electron-squirrel-startup/node_modules/ms/index.js ***!
  \*************************************************************************/
(module) {

/**
 * Helpers.
 */

var s = 1000;
var m = s * 60;
var h = m * 60;
var d = h * 24;
var y = d * 365.25;

/**
 * Parse or format the given `val`.
 *
 * Options:
 *
 *  - `long` verbose formatting [false]
 *
 * @param {String|Number} val
 * @param {Object} [options]
 * @throws {Error} throw an error if val is not a non-empty string or a number
 * @return {String|Number}
 * @api public
 */

module.exports = function(val, options) {
  options = options || {};
  var type = typeof val;
  if (type === 'string' && val.length > 0) {
    return parse(val);
  } else if (type === 'number' && isNaN(val) === false) {
    return options.long ? fmtLong(val) : fmtShort(val);
  }
  throw new Error(
    'val is not a non-empty string or a valid number. val=' +
      JSON.stringify(val)
  );
};

/**
 * Parse the given `str` and return milliseconds.
 *
 * @param {String} str
 * @return {Number}
 * @api private
 */

function parse(str) {
  str = String(str);
  if (str.length > 100) {
    return;
  }
  var match = /^((?:\d+)?\.?\d+) *(milliseconds?|msecs?|ms|seconds?|secs?|s|minutes?|mins?|m|hours?|hrs?|h|days?|d|years?|yrs?|y)?$/i.exec(
    str
  );
  if (!match) {
    return;
  }
  var n = parseFloat(match[1]);
  var type = (match[2] || 'ms').toLowerCase();
  switch (type) {
    case 'years':
    case 'year':
    case 'yrs':
    case 'yr':
    case 'y':
      return n * y;
    case 'days':
    case 'day':
    case 'd':
      return n * d;
    case 'hours':
    case 'hour':
    case 'hrs':
    case 'hr':
    case 'h':
      return n * h;
    case 'minutes':
    case 'minute':
    case 'mins':
    case 'min':
    case 'm':
      return n * m;
    case 'seconds':
    case 'second':
    case 'secs':
    case 'sec':
    case 's':
      return n * s;
    case 'milliseconds':
    case 'millisecond':
    case 'msecs':
    case 'msec':
    case 'ms':
      return n;
    default:
      return undefined;
  }
}

/**
 * Short format for `ms`.
 *
 * @param {Number} ms
 * @return {String}
 * @api private
 */

function fmtShort(ms) {
  if (ms >= d) {
    return Math.round(ms / d) + 'd';
  }
  if (ms >= h) {
    return Math.round(ms / h) + 'h';
  }
  if (ms >= m) {
    return Math.round(ms / m) + 'm';
  }
  if (ms >= s) {
    return Math.round(ms / s) + 's';
  }
  return ms + 'ms';
}

/**
 * Long format for `ms`.
 *
 * @param {Number} ms
 * @return {String}
 * @api private
 */

function fmtLong(ms) {
  return plural(ms, d, 'day') ||
    plural(ms, h, 'hour') ||
    plural(ms, m, 'minute') ||
    plural(ms, s, 'second') ||
    ms + ' ms';
}

/**
 * Pluralization helper.
 */

function plural(ms, n, name) {
  if (ms < n) {
    return;
  }
  if (ms < n * 1.5) {
    return Math.floor(ms / n) + ' ' + name;
  }
  return Math.ceil(ms / n) + ' ' + name + 's';
}


/***/ },

/***/ "./src/index.ts"
/*!**********************!*\
  !*** ./src/index.ts ***!
  \**********************/
(__unused_webpack_module, exports, __webpack_require__) {

"use strict";

var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", ({ value: true }));
const electron_1 = __webpack_require__(/*! electron */ "electron");
const path = __importStar(__webpack_require__(/*! path */ "path"));
const fs = __importStar(__webpack_require__(/*! fs */ "fs"));
const paths_1 = __webpack_require__(/*! ./main/paths */ "./src/main/paths.ts");
const database_1 = __webpack_require__(/*! ./main/database */ "./src/main/database.ts");
const fileSystem_1 = __webpack_require__(/*! ./main/fileSystem */ "./src/main/fileSystem.ts");
// Basic validators
function isString(v) {
    return typeof v === 'string';
}
function isNonEmptyString(v) {
    return isString(v) && v.trim().length > 0;
}
function isPositiveInteger(v) {
    return typeof v === 'number' && Number.isInteger(v) && v >= 0;
}
function isStringArray(v) {
    return Array.isArray(v) && v.every(i => typeof i === 'string');
}
// Global error handlers
process.on('uncaughtException', (err) => {
    console.error('[main] uncaughtException', err && err.stack ? err.stack : err);
});
process.on('unhandledRejection', (reason) => {
    console.error('[main] unhandledRejection', reason && reason.stack ? reason.stack : reason);
});
// Windows installer check
try {
    if (__webpack_require__(/*! electron-squirrel-startup */ "./node_modules/electron-squirrel-startup/index.js")) {
        electron_1.app.quit();
    }
}
catch (err) {
    console.warn('[main] squirrel check failed:', err);
}
// Global variable for pending file paths
let pendingFilePaths = [];
electron_1.app.disableHardwareAcceleration();
let mainWindow = null;
function getInternalHostnames() {
    const hosts = new Set(['localhost', '127.0.0.1', '::1']);
    try {
        if ( true && 'http://localhost:3000/main_window/index.html'.startsWith('http')) {
            const u = new URL('http://localhost:3000/main_window/index.html');
            if (u.hostname)
                hosts.add(u.hostname);
        }
    }
    catch (err) {
        console.warn('[main] getInternalHostnames parse failed', err);
    }
    return hosts;
}
function shouldOpenExternally(urlStr, internalHosts) {
    if (!urlStr)
        return false;
    try {
        const parsed = new URL(urlStr);
        const protocol = parsed.protocol.toLowerCase();
        if (protocol !== 'http:' && protocol !== 'https:')
            return false;
        if (internalHosts.has(parsed.hostname))
            return false;
        return true;
    }
    catch (_a) {
        return false;
    }
}
const createWindow = () => {
    var _a, _b;
    console.log('[main] createWindow() - start');
    try {
        // Attempt to restore previous window state (bounds + maximized)
        const stateFile = path.join((0, paths_1.getDataDir)(), 'window-state.json');
        let restoredState = {};
        try {
            if (fs.existsSync(stateFile)) {
                const raw = fs.readFileSync(stateFile, 'utf8');
                restoredState = JSON.parse(raw || '{}');
            }
        }
        catch (err) {
            console.warn('[main] failed to read window state:', err);
            restoredState = {};
        }
        // pick best dev icon per-platform (Windows prefers .ico for taskbar)
        const devIconFile = process.platform === 'win32' ? path.join(__dirname, '..', 'assets', 'icon.ico') : path.join(__dirname, '..', 'assets', 'icon.png');
        try {
            console.log('[main] using dev icon:', devIconFile, 'exists=', fs.existsSync(devIconFile));
        }
        catch (err) {
            console.warn('[main] dev icon check failed', err);
        }
        const bwOpts = {
            width: (_a = restoredState.width) !== null && _a !== void 0 ? _a : 1200,
            height: (_b = restoredState.height) !== null && _b !== void 0 ? _b : 800,
            minWidth: 790,
            minHeight: 550,
            webPreferences: {
                preload: 'C:\\Projects\\Git\\measly-notes\\.webpack\\renderer\\main_window\\preload.js',
                contextIsolation: true,
                nodeIntegration: false,
                spellcheck: true,
            },
            // Use platform-specific icon during development.
            icon: devIconFile,
            show: false,
            autoHideMenuBar: true,
        };
        if (typeof restoredState.x === 'number' && typeof restoredState.y === 'number') {
            bwOpts.x = restoredState.x;
            bwOpts.y = restoredState.y;
        }
        mainWindow = new electron_1.BrowserWindow(bwOpts);
        mainWindow.once('ready-to-show', () => {
            try {
                mainWindow === null || mainWindow === void 0 ? void 0 : mainWindow.show();
            }
            catch (err) {
                console.error('[main] error showing window', err);
            }
            try {
                if (restoredState.isMaximized && mainWindow && !mainWindow.isDestroyed()) {
                    try {
                        mainWindow.maximize();
                    }
                    catch (err) {
                        console.warn('[main] failed to maximize on restore', err);
                    }
                }
            }
            catch (err) {
                console.warn('[main] ready-to-show handler failed', err);
            }
        });
        const internalHosts = getInternalHostnames();
        if (electron_1.app.isPackaged) {
            mainWindow.webContents.on('will-navigate', (event, url) => {
                event.preventDefault();
                if (shouldOpenExternally(url, internalHosts)) {
                    try {
                        electron_1.shell.openExternal(url);
                        console.log('[main] opened external URL from will-navigate:', url);
                    }
                    catch (err) {
                        console.warn('[main] failed to open external URL from will-navigate:', url, err);
                    }
                }
                else {
                    console.log('[main] blocked internal navigation attempt to:', url);
                }
            });
        }
        else {
            // In dev, allow all internal navigation for smooth hot reloading
            mainWindow.webContents.on('will-navigate', (_event, url) => {
                // No action, allow navigation for fast refresh
            });
        }
        try {
            const wcAny = mainWindow.webContents;
            if (wcAny && typeof wcAny.setWindowOpenHandler === 'function') {
                wcAny.setWindowOpenHandler(({ url }) => {
                    if (shouldOpenExternally(url, internalHosts)) {
                        try {
                            electron_1.shell.openExternal(url);
                            console.log('[main] opened external URL from setWindowOpenHandler:', url);
                        }
                        catch (err) {
                            console.warn('[main] failed to open external URL from setWindowOpenHandler:', url, err);
                        }
                    }
                    else {
                        console.log('[main] denied window.open to internal URL:', url);
                    }
                    return { action: 'deny' };
                });
            }
            else if (wcAny && typeof wcAny.on === 'function') {
                wcAny.on('new-window', (event, url) => {
                    try {
                        event.preventDefault();
                    }
                    catch (err) {
                        console.warn('[main] event.preventDefault failed', err);
                    }
                    const urlStr = String(url || '');
                    if (shouldOpenExternally(urlStr, internalHosts)) {
                        try {
                            electron_1.shell.openExternal(urlStr);
                            console.log('[main] opened external URL from new-window fallback:', urlStr);
                        }
                        catch (err) {
                            console.warn('[main] failed to open external URL from new-window fallback:', urlStr, err);
                        }
                    }
                    else {
                        console.log('[main] denied new-window to internal URL:', urlStr);
                    }
                });
            }
        }
        catch (err) {
            console.warn('[main] window-open handlers setup failed:', err);
        }
        mainWindow.on('closed', () => { mainWindow = null; });
        // Persist window bounds and maximized state on close
        try {
            const stateFilePath = path.join((0, paths_1.getDataDir)(), 'window-state.json');
            mainWindow.on('close', () => {
                try {
                    if (!mainWindow)
                        return;
                    const isMax = mainWindow.isMaximized();
                    // Prefer to store the "normal" bounds if maximized so we can restore properly
                    let bounds = mainWindow.getBounds();
                    try {
                        // getNormalBounds exists on modern Electron; fallback to getBounds
                        if (isMax && mainWindow && typeof mainWindow.getNormalBounds === 'function')
                            bounds = mainWindow.getNormalBounds();
                    }
                    catch (err) {
                        console.warn('[main] failed to get normal bounds', err);
                    }
                    const out = {
                        x: bounds.x,
                        y: bounds.y,
                        width: bounds.width,
                        height: bounds.height,
                        isMaximized: isMax,
                    };
                    try {
                        fs.mkdirSync((0, paths_1.getDataDir)(), { recursive: true });
                    }
                    catch (err) {
                        console.warn('[main] failed to create data dir', err);
                    }
                    try {
                        fs.writeFileSync(stateFilePath, JSON.stringify(out), 'utf8');
                    }
                    catch (err) {
                        console.warn('[main] failed to write window state', err);
                    }
                }
                catch (err) {
                    console.warn('[main] error while saving window state', err);
                }
            });
        }
        catch (err) {
            console.warn('[main] failed to register window state saver', err);
        }
        mainWindow.loadURL('http://localhost:3000/main_window/index.html').catch((err) => __awaiter(void 0, void 0, void 0, function* () {
            console.error('[main] loadURL failed', err && err.stack ? err.stack : err);
            try {
                // Dev server port mismatch can happen; try a common alternative (9000) if the entry references 3000
                if ( true && 'http://localhost:3000/main_window/index.html'.includes(':3000')) {
                    const alt = 'http://localhost:3000/main_window/index.html'.replace(':3000', ':9000');
                    console.log('[main] attempting fallback dev URL:', alt);
                    try {
                        yield (mainWindow === null || mainWindow === void 0 ? void 0 : mainWindow.loadURL(alt));
                        console.log('[main] fallback dev URL loaded successfully');
                        return;
                    }
                    catch (err2) {
                        console.warn('[main] fallback dev URL failed', err2);
                    }
                }
            }
            catch (e) {
                console.warn('[main] error in loadURL fallback', e);
            }
        }));
        // Send pending file paths to renderer after window is ready
        mainWindow.webContents.on('did-finish-load', () => {
            if (pendingFilePaths.length > 0) {
                const paths = [...pendingFilePaths];
                pendingFilePaths = []; // Clear after sending
                for (const filePath of paths) {
                    mainWindow === null || mainWindow === void 0 ? void 0 : mainWindow.webContents.send('open-md-file', filePath);
                }
            }
        });
        if (true) {
            mainWindow.webContents.openDevTools();
        }
    }
    catch (err) {
        console.error('[main] createWindow threw', err && err.stack ? err.stack : err);
        throw err;
    }
};
function setDefaultSpellCheckerLanguages(langs) {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            yield electron_1.session.defaultSession.setSpellCheckerLanguages(langs);
            if (electron_1.session.defaultSession.setSpellCheckerEnabled) {
                try {
                    electron_1.session.defaultSession.setSpellCheckerEnabled(true);
                }
                catch (err) {
                    console.warn('[main] could not setSpellCheckerEnabled:', err);
                }
            }
            console.log('[main] spellchecker languages set to:', langs);
        }
        catch (err) {
            console.warn('[main] failed to set spellchecker languages:', err);
        }
    });
}
// Keep an in-memory map of outstanding force-save requests so we can match replies.
const pendingForceSaves = new Map();
// Handle renderer -> main completion messages
electron_1.ipcMain.on('force-save-complete', (event, requestId) => {
    if (!requestId)
        return;
    const pending = pendingForceSaves.get(requestId);
    if (!pending)
        return;
    // ensure sender is same window that requested the save
    if (event.sender.id !== pending.webContentsId) {
        // ignore mismatched sender
        return;
    }
    clearTimeout(pending.timer);
    pending.resolve(true);
    pendingForceSaves.delete(requestId);
});
// Allow renderer to show a folder picker for export destination
electron_1.ipcMain.handle('select-export-folder', (event) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b;
    try {
        const win = (_b = (_a = electron_1.BrowserWindow.fromWebContents(event.sender)) !== null && _a !== void 0 ? _a : mainWindow) !== null && _b !== void 0 ? _b : undefined;
        const res = yield electron_1.dialog.showOpenDialog(win, { properties: ['openDirectory', 'createDirectory'] });
        if (!res || res.canceled || !res.filePaths || res.filePaths.length === 0)
            return null;
        return res.filePaths[0];
    }
    catch (err) {
        console.warn('[main] select-export-folder failed', err);
        return null;
    }
}));
// Export a PDF using the sender's webContents (current window). Expects full folder path and desired fileName.
electron_1.ipcMain.handle('export-pdf', (event, folderPath, fileName) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        if (!folderPath || !fileName)
            return { ok: false, error: 'Invalid arguments' };
        // ensure folder exists
        try {
            fs.mkdirSync(folderPath, { recursive: true });
        }
        catch (e) {
            console.warn('[main] export-pdf mkdir failed', e);
        }
        const sanitize = (s) => s.replace(/[<>:"/\\|?*]+/g, '_');
        const base = sanitize(fileName);
        let outPath = path.join(folderPath, base);
        // if exists, append a colon-free time suffix: " (hh-mm)". If that also exists,
        // append a version marker like " (hh-mm) v2", " (hh-mm) v3", etc.
        if (fs.existsSync(outPath)) {
            const now = new Date();
            const hh = String(now.getHours()).padStart(2, '0');
            const mm = String(now.getMinutes()).padStart(2, '0');
            const timeSuffix = ` (${hh}-${mm})`;
            const ext = path.extname(base);
            const nameOnly = base.substring(0, base.length - ext.length);
            let candidate = `${nameOnly}${timeSuffix}${ext}`;
            let counter = 1;
            let candidatePath = path.join(folderPath, candidate);
            while (fs.existsSync(candidatePath)) {
                counter += 1;
                candidate = `${nameOnly}${timeSuffix} v${counter}${ext}`;
                candidatePath = path.join(folderPath, candidate);
            }
            outPath = candidatePath;
        }
        // Use the sender webContents to print to PDF. The renderer is expected to have injected
        // any print-specific styles (white background, @page margins) before calling this.
        const pdfOpts = {
            printBackground: true,
            // request A4; many Electron versions accept pageSize: 'A4'
            pageSize: 'A4',
        };
        const data = yield event.sender.printToPDF(pdfOpts);
        fs.writeFileSync(outPath, data);
        return { ok: true, path: outPath };
    }
    catch (err) {
        console.warn('[main] export-pdf failed', err);
        return { ok: false, error: err && err.message ? err.message : String(err) };
    }
}));
// Export a note as Markdown file. Expects full folder path, desired fileName, and content.
electron_1.ipcMain.handle('export-md', (event, folderPath, fileName, content) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        if (!folderPath || !fileName || content === undefined)
            return { ok: false, error: 'Invalid arguments' };
        // ensure folder exists
        try {
            fs.mkdirSync(folderPath, { recursive: true });
        }
        catch (e) {
            console.warn('[main] export-md mkdir failed', e);
        }
        const sanitize = (s) => s.replace(/[<>:"/\\|?*]+/g, '_');
        const base = sanitize(fileName);
        let outPath = path.join(folderPath, base);
        // if exists, append a colon-free time suffix: " (hh-mm)". If that also exists,
        // append a version marker like " (hh-mm) v2", " (hh-mm) v3", etc.
        if (fs.existsSync(outPath)) {
            const now = new Date();
            const hh = String(now.getHours()).padStart(2, '0');
            const mm = String(now.getMinutes()).padStart(2, '0');
            const timeSuffix = ` (${hh}-${mm})`;
            const ext = path.extname(base);
            const nameOnly = base.substring(0, base.length - ext.length);
            let candidate = `${nameOnly}${timeSuffix}${ext}`;
            let counter = 1;
            let candidatePath = path.join(folderPath, candidate);
            while (fs.existsSync(candidatePath)) {
                counter += 1;
                candidate = `${nameOnly}${timeSuffix} v${counter}${ext}`;
                candidatePath = path.join(folderPath, candidate);
            }
            outPath = candidatePath;
        }
        fs.writeFileSync(outPath, content, 'utf-8');
        return { ok: true, path: outPath };
    }
    catch (err) {
        console.warn('[main] export-md failed', err);
        return { ok: false, error: err && err.message ? err.message : String(err) };
    }
}));
// Rename a tag (merge if target name exists)
electron_1.ipcMain.handle('rename-tag', (event, tagId, newName) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b;
    try {
        if (typeof tagId !== 'number' || Number.isNaN(tagId) || !newName)
            return { ok: false, error: 'Invalid arguments' };
        try {
            (0, database_1.renameTag)(tagId, String(newName));
            return { ok: true };
        }
        catch (err) {
            return { ok: false, error: (_a = err === null || err === void 0 ? void 0 : err.message) !== null && _a !== void 0 ? _a : String(err) };
        }
    }
    catch (err) {
        console.warn('[main] rename-tag handler failed', err);
        return { ok: false, error: (_b = err === null || err === void 0 ? void 0 : err.message) !== null && _b !== void 0 ? _b : String(err) };
    }
}));
// Temp note operations
electron_1.ipcMain.handle('create-temp-note', (_event, title, externalPath, originalEncoding) => __awaiter(void 0, void 0, void 0, function* () {
    if (typeof title !== 'string' || typeof externalPath !== 'string')
        return null;
    try {
        return (0, database_1.createTempNote)(String(title), String(externalPath), typeof originalEncoding === 'string' ? String(originalEncoding) : undefined);
    }
    catch (err) {
        console.warn('[main] create-temp-note failed', err);
        return null;
    }
}));
electron_1.ipcMain.handle('update-temp-note-state', (_event, noteId, hasUnsavedChanges, syncMode) => __awaiter(void 0, void 0, void 0, function* () {
    if (typeof noteId !== 'number' || typeof hasUnsavedChanges !== 'boolean' || typeof syncMode !== 'boolean')
        return;
    try {
        (0, database_1.updateTempNoteState)(noteId, hasUnsavedChanges, syncMode);
    }
    catch (err) {
        console.warn('[main] update-temp-note-state failed', err);
    }
}));
electron_1.ipcMain.handle('convert-temp-note-to-regular', (_event, noteId, newFilePath) => __awaiter(void 0, void 0, void 0, function* () {
    if (typeof noteId !== 'number' || typeof newFilePath !== 'string')
        return;
    try {
        (0, database_1.convertTempNoteToRegular)(noteId, String(newFilePath));
    }
    catch (err) {
        console.warn('[main] convert-temp-note-to-regular failed', err);
    }
}));
electron_1.ipcMain.handle('get-temp-notes', () => __awaiter(void 0, void 0, void 0, function* () {
    try {
        return (0, database_1.getTempNotes)();
    }
    catch (err) {
        console.warn('[main] get-temp-notes failed', err);
        return [];
    }
}));
electron_1.ipcMain.handle('delete-temp-note', (_event, noteId) => __awaiter(void 0, void 0, void 0, function* () {
    if (typeof noteId !== 'number')
        return;
    try {
        (0, database_1.deleteTempNote)(noteId);
    }
    catch (err) {
        console.warn('[main] delete-temp-note failed', err);
    }
}));
electron_1.ipcMain.handle('get-pending-file-paths', () => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const paths = [...pendingFilePaths];
        pendingFilePaths = []; // Clear after returning
        return paths;
    }
    catch (err) {
        console.warn('[main] get-pending-file-paths failed', err);
        return [];
    }
}));
// File operations for temp notes
electron_1.ipcMain.handle('read-file-content', (_event, filePath) => __awaiter(void 0, void 0, void 0, function* () {
    if (typeof filePath !== 'string')
        return null;
    try {
        return yield (0, fileSystem_1.loadNoteContent)(filePath);
    }
    catch (err) {
        console.warn('[main] read-file-content failed', err);
        return null;
    }
}));
electron_1.ipcMain.handle('write-file-content', (_event, filePath, content) => __awaiter(void 0, void 0, void 0, function* () {
    if (typeof filePath !== 'string' || typeof content !== 'string')
        return false;
    try {
        fs.writeFileSync(String(filePath), String(content), 'utf8');
        return true;
    }
    catch (err) {
        console.warn('[main] write-file-content failed', err);
        return false;
    }
}));
electron_1.ipcMain.handle('show-save-dialog', (_event, options) => __awaiter(void 0, void 0, void 0, function* () {
    if (typeof options !== 'object' || !options)
        return null;
    try {
        return yield electron_1.dialog.showSaveDialog(mainWindow, options);
    }
    catch (err) {
        console.warn('[main] show-save-dialog failed', err);
        return null;
    }
}));
electron_1.ipcMain.handle('get-file-basename', (_event, filePath) => __awaiter(void 0, void 0, void 0, function* () {
    if (typeof filePath !== 'string')
        return '';
    try {
        return path.basename(String(filePath));
    }
    catch (err) {
        console.warn('[main] get-file-basename failed', err);
        return '';
    }
}));
electron_1.app.whenReady().then(() => __awaiter(void 0, void 0, void 0, function* () {
    console.log('[main] app.whenReady started');
    try {
        yield (0, database_1.initDatabase)();
        yield (0, fileSystem_1.initFileSystem)();
        yield setDefaultSpellCheckerLanguages(['en-US', 'de-DE']);
        // webRequest whitelist/block: Only enable in production
        if (electron_1.app.isPackaged) {
            const whitelistHostnames = getInternalHostnames();
            try {
                if ( true && 'http://localhost:3000/main_window/index.html'.startsWith('http')) {
                    const mainHost = new URL('http://localhost:3000/main_window/index.html').hostname;
                    whitelistHostnames.add(mainHost);
                }
            }
            catch (err) {
                console.warn('[main] failed to parse MAIN_WINDOW_WEBPACK_ENTRY', err);
            }
            // Block http(s) and ws(s) in production only
            electron_1.session.defaultSession.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*', 'ws://*/*', 'wss://*/*'] }, (details, callback) => {
                try {
                    const urlStr = details.url || '';
                    if (urlStr.startsWith('file:'))
                        return callback({ cancel: false });
                    let hostname = '';
                    try {
                        hostname = new URL(urlStr).hostname;
                    }
                    catch (_a) {
                        return callback({ cancel: true });
                    }
                    if (whitelistHostnames.has(hostname))
                        return callback({ cancel: false });
                    return callback({ cancel: true });
                }
                catch (err) {
                    return callback({ cancel: true });
                }
            });
            console.log('[main] renderer http/https/ws requests will be blocked (whitelist applied).');
        }
        else {
            // Allow all requests in development for live reload/hot CSS 
            console.log('[main] DEV MODE: All renderer http/https/ws requests allowed for live reload/hot CSS!');
        }
    }
    catch (err) {
        console.error('[main] initialization error', err && err.stack ? err.stack : err);
        throw err;
    }
    // File association for .md files
    if (process.platform === 'win32') {
        electron_1.app.setAsDefaultProtocolClient('measly-notes', process.execPath, [path.dirname(process.execPath)]);
    }
    // Handle file opening (double-click .md/.txt files or command line args)
    // Check command line arguments for .md and .txt files
    const args = process.argv.slice(1);
    for (const arg of args) {
        if ((arg.endsWith('.md') || arg.endsWith('.txt')) && fs.existsSync(arg)) {
            pendingFilePaths.push(path.resolve(arg));
        }
    }
    // Handle second-instance events (when app is already running and user opens another .md file)
    electron_1.app.on('second-instance', (event, commandLine) => {
        // Focus the main window
        if (mainWindow) {
            if (mainWindow.isMinimized())
                mainWindow.restore();
            mainWindow.focus();
        }
        // Check for .md/.txt files in the command line
        const args = commandLine.slice(1);
        for (const arg of args) {
            if ((arg.endsWith('.md') || arg.endsWith('.txt')) && fs.existsSync(arg)) {
                pendingFilePaths.push(path.resolve(arg));
                // Send to renderer to handle
                if (mainWindow && mainWindow.webContents) {
                    mainWindow.webContents.send('open-md-file', path.resolve(arg));
                }
            }
        }
    });
    // Handle open-file events (macOS)
    electron_1.app.on('open-file', (event, filePath) => {
        event.preventDefault();
        if ((filePath.endsWith('.md') || filePath.endsWith('.txt')) && fs.existsSync(filePath)) {
            pendingFilePaths.push(path.resolve(filePath));
            // Send to renderer to handle
            if (mainWindow && mainWindow.webContents) {
                mainWindow.webContents.send('open-md-file', path.resolve(filePath));
            }
        }
    });
    // Register IPC handlers (validate inputs) - same set as before (create-note, save-note, etc.)
    try {
        electron_1.ipcMain.handle('create-note', (_event, title) => __awaiter(void 0, void 0, void 0, function* () {
            var _a, _b;
            if (!isString(title))
                throw new Error('Invalid title');
            const note = (0, database_1.createNote)(String(title), '');
            // generate token & filename
            const token = (0, database_1.generateUniqueFileToken)();
            try {
                (0, database_1.setNoteFileToken)(note.id, token);
            }
            catch (err) {
                console.warn('[main] setNoteFileToken failed', err);
            }
            const created = (_b = (_a = (0, database_1.getNoteById)(note.id)) === null || _a === void 0 ? void 0 : _a.createdAt) !== null && _b !== void 0 ? _b : new Date().toISOString();
            const d = new Date(created);
            const yy = String(d.getFullYear()).slice(-2);
            const mm = String(d.getMonth() + 1).padStart(2, '0');
            const dd = String(d.getDate()).padStart(2, '0');
            const hh = String(d.getHours()).padStart(2, '0');
            const min = String(d.getMinutes()).padStart(2, '0');
            const fname = `${yy}-${mm}-${dd}_${hh}-${min}_${token}.md`;
            const filePath = yield (0, fileSystem_1.saveNoteContent)(note.id, '', fname);
            (0, database_1.updateNoteFilePath)(note.id, filePath);
            try {
                (0, database_1.upsertNoteFts)(note.id, note.title, '');
            }
            catch (err) {
                console.warn('[main] could not create FTS entry for new note', note.id, err);
            }
            const updatedNote = (0, database_1.getNoteById)(note.id);
            if (!updatedNote)
                throw new Error(`Failed to retrieve note ${note.id} after creation`);
            return updatedNote;
        }));
        electron_1.ipcMain.handle('save-note', (_event, id, content) => __awaiter(void 0, void 0, void 0, function* () {
            var _a, _b;
            if (!isPositiveInteger(id) || !isString(content))
                throw new Error('Invalid save-note args');
            const nid = Number(id);
            const note = (0, database_1.getNoteById)(nid);
            if (note) {
                // Ensure token exists
                let token = note.fileToken;
                if (!token) {
                    try {
                        token = (0, database_1.generateUniqueFileToken)();
                        (0, database_1.setNoteFileToken)(nid, token);
                    }
                    catch (err) {
                        console.warn('[main] could not generate/set token for note', nid, err);
                    }
                }
                // Build filename using createdAt and token
                const created = (_a = note.createdAt) !== null && _a !== void 0 ? _a : new Date().toISOString();
                const d = new Date(created);
                const yy = String(d.getFullYear()).slice(-2);
                const mm = String(d.getMonth() + 1).padStart(2, '0');
                const dd = String(d.getDate()).padStart(2, '0');
                const hh = String(d.getHours()).padStart(2, '0');
                const min = String(d.getMinutes()).padStart(2, '0');
                const fname = `${yy}-${mm}-${dd}_${hh}-${min}_${token}.md`;
                const filePath = yield (0, fileSystem_1.saveNoteContent)(nid, String(content), fname);
                if (filePath && filePath !== note.filePath)
                    (0, database_1.updateNoteFilePath)(nid, filePath);
                (0, database_1.updateNote)(nid);
                try {
                    (0, database_1.upsertNoteFts)(nid, note.title, String(content));
                }
                catch (err) {
                    console.error('[main] failed to update FTS index for note', id, err);
                }
                return (_b = (0, database_1.getNoteById)(nid)) !== null && _b !== void 0 ? _b : null;
            }
            return null;
        }));
        electron_1.ipcMain.handle('load-note', (_event, id) => __awaiter(void 0, void 0, void 0, function* () {
            if (!isPositiveInteger(id))
                throw new Error('Invalid id');
            const note = (0, database_1.getNoteById)(Number(id));
            if (note)
                return yield (0, fileSystem_1.loadNoteContent)(note.filePath);
            return '';
        }));
        electron_1.ipcMain.handle('get-all-notes', () => __awaiter(void 0, void 0, void 0, function* () { return (0, database_1.getAllNotes)(); }));
        electron_1.ipcMain.handle('delete-note', (_event, id) => __awaiter(void 0, void 0, void 0, function* () {
            if (!isPositiveInteger(id))
                throw new Error('Invalid id');
            const note = (0, database_1.getNoteById)(Number(id));
            if (note) {
                yield (0, fileSystem_1.deleteNoteFile)(note.filePath);
                (0, database_1.deleteNote)(Number(id));
                try {
                    (0, database_1.removeNoteFts)(Number(id));
                }
                catch (err) {
                    console.warn('[main] failed to remove FTS entry for deleted note', id, err);
                }
            }
        }));
        electron_1.ipcMain.handle('save-note-snapshot', (_event, noteId, content, isManual) => __awaiter(void 0, void 0, void 0, function* () {
            if (!isPositiveInteger(noteId))
                throw new Error('Invalid noteId');
            if (typeof content !== 'string')
                throw new Error('Invalid content');
            (0, database_1.saveNoteSnapshot)(Number(noteId), content, Boolean(isManual));
        }));
        electron_1.ipcMain.handle('get-note-snapshots', (_event, noteId) => __awaiter(void 0, void 0, void 0, function* () {
            if (!isPositiveInteger(noteId))
                throw new Error('Invalid noteId');
            return (0, database_1.getNoteSnapshots)(Number(noteId));
        }));
        electron_1.ipcMain.handle('delete-note-snapshot', (_event, snapshotId) => __awaiter(void 0, void 0, void 0, function* () {
            if (!isPositiveInteger(snapshotId))
                throw new Error('Invalid snapshotId');
            (0, database_1.deleteNoteSnapshot)(Number(snapshotId));
        }));
        electron_1.ipcMain.handle('update-note-title', (_event, id, title) => __awaiter(void 0, void 0, void 0, function* () {
            if (!isPositiveInteger(id) || !isString(title))
                throw new Error('Invalid args');
            (0, database_1.updateNoteTitle)(Number(id), String(title));
            try {
                const note = (0, database_1.getNoteById)(Number(id));
                if (note) {
                    const content = yield (0, fileSystem_1.loadNoteContent)(note.filePath);
                    (0, database_1.upsertNoteFts)(Number(id), String(title), content);
                }
            }
            catch (err) {
                console.warn('[main] failed to update FTS entry after title change', id, err);
            }
        }));
        electron_1.ipcMain.handle('get-notes-page', (_event, page, perPage) => __awaiter(void 0, void 0, void 0, function* () {
            if (!isPositiveInteger(page) || !isPositiveInteger(perPage))
                throw new Error('Invalid pagination args');
            return (0, database_1.getNotesPage)(Number(page), Number(perPage));
        }));
        electron_1.ipcMain.handle('add-tag-to-note', (_event, noteId, tagName, position) => __awaiter(void 0, void 0, void 0, function* () {
            if (!isPositiveInteger(noteId) || !isNonEmptyString(tagName) || typeof position !== 'number')
                throw new Error('Invalid args for add-tag-to-note');
            return (0, database_1.addTagToNote)(Number(noteId), String(tagName), Number(position));
        }));
        electron_1.ipcMain.handle('remove-tag-from-note', (_event, noteId, tagId) => __awaiter(void 0, void 0, void 0, function* () {
            if (!isPositiveInteger(noteId) || !isPositiveInteger(tagId))
                throw new Error('Invalid args');
            (0, database_1.removeTagFromNote)(Number(noteId), Number(tagId));
        }));
        electron_1.ipcMain.handle('reorder-note-tags', (_event, noteId, tagIds) => __awaiter(void 0, void 0, void 0, function* () {
            if (!isPositiveInteger(noteId) || !Array.isArray(tagIds))
                throw new Error('Invalid args');
            (0, database_1.reorderNoteTags)(Number(noteId), tagIds);
        }));
        electron_1.ipcMain.handle('get-note-tags', (_event, noteId) => __awaiter(void 0, void 0, void 0, function* () {
            if (!isPositiveInteger(noteId))
                throw new Error('Invalid args');
            return (0, database_1.getNoteTags)(Number(noteId));
        }));
        electron_1.ipcMain.handle('get-all-tags', () => __awaiter(void 0, void 0, void 0, function* () { return (0, database_1.getAllTags)(); }));
        electron_1.ipcMain.handle('get-top-tags', (_event, limit) => __awaiter(void 0, void 0, void 0, function* () {
            if (!isPositiveInteger(limit))
                throw new Error('Invalid args');
            return (0, database_1.getTopTags)(Number(limit));
        }));
        electron_1.ipcMain.handle('search-notes', (_event, query) => __awaiter(void 0, void 0, void 0, function* () {
            if (!isString(query))
                throw new Error('Invalid query');
            try {
                return yield (0, database_1.searchNotes)(String(query));
            }
            catch (err) {
                console.error('[main] search-notes failed', err);
                return [];
            }
        }));
        electron_1.ipcMain.handle('search-notes-by-tag', (_event, tagName) => __awaiter(void 0, void 0, void 0, function* () {
            if (!isString(tagName))
                throw new Error('Invalid tagName');
            return (0, database_1.searchNotesByTag)(String(tagName));
        }));
        electron_1.ipcMain.handle('get-notes-by-primary-tag', () => __awaiter(void 0, void 0, void 0, function* () { return (0, database_1.getNotesByPrimaryTag)(); }));
        electron_1.ipcMain.handle('get-category-hierarchy', () => __awaiter(void 0, void 0, void 0, function* () { return (0, database_1.getCategoryHierarchy)(); }));
        electron_1.ipcMain.handle('get-hierarchy-for-tag', (_event, tagName) => __awaiter(void 0, void 0, void 0, function* () {
            if (!isString(tagName))
                throw new Error('Invalid tagName');
            return (0, database_1.getHierarchyForTag)(String(tagName));
        }));
        electron_1.ipcMain.handle('get-notes-in-trash', () => __awaiter(void 0, void 0, void 0, function* () { return (0, database_1.getNotesInTrash)(); }));
        electron_1.ipcMain.handle('trigger-sync', () => __awaiter(void 0, void 0, void 0, function* () {
            try {
                const res = yield (0, database_1.reconcileNotesWithFs)();
                // Create a report note summarizing the sync
                try {
                    const title = 'Report: Sync';
                    const note = (0, database_1.createNote)(title, '');
                    const token = (0, database_1.generateUniqueFileToken)();
                    try {
                        (0, database_1.setNoteFileToken)(note.id, token);
                    }
                    catch (err) {
                        console.warn('[main] setNoteFileToken failed for report', err);
                    }
                    const nowIso = new Date().toISOString();
                    try {
                        (0, database_1.updateNoteCreatedAt)(note.id, nowIso);
                    }
                    catch (_a) {
                        void 0;
                    }
                    try {
                        (0, database_1.updateNoteLastEdited)(note.id, nowIso);
                    }
                    catch (_b) {
                        void 0;
                    }
                    const parts = [];
                    parts.push(`# ${title}`);
                    parts.push(`**Time:** ${nowIso}`);
                    parts.push('');
                    parts.push(`- Created notes: ${res.createdNoteIds.length}`);
                    parts.push(`- Updated paths: ${res.updatedPaths.length}`);
                    parts.push(`- Marked deleted: ${res.markedDeletedNoteIds.length}`);
                    parts.push('');
                    if (res.createdNoteIds.length) {
                        parts.push('### Created Note IDs');
                        for (const id of res.createdNoteIds)
                            parts.push(`- ${id}`);
                        parts.push('');
                    }
                    if (res.updatedPaths.length) {
                        parts.push('### Updated Paths');
                        for (const u of res.updatedPaths)
                            parts.push(`- ${u.noteId}: ${u.oldPath} -> ${u.newPath}`);
                        parts.push('');
                    }
                    if (res.markedDeletedNoteIds.length) {
                        parts.push('### Marked Deleted');
                        for (const id of res.markedDeletedNoteIds)
                            parts.push(`- ${id}`);
                        parts.push('');
                    }
                    const content = parts.join('\n');
                    const d = new Date(nowIso);
                    const yy = String(d.getFullYear()).slice(-2);
                    const mm = String(d.getMonth() + 1).padStart(2, '0');
                    const dd = String(d.getDate()).padStart(2, '0');
                    const hh = String(d.getHours()).padStart(2, '0');
                    const min = String(d.getMinutes()).padStart(2, '0');
                    const fname = `${yy}-${mm}-${dd}_${hh}-${min}_${token}.md`;
                    const pathSaved = yield (0, fileSystem_1.saveNoteContent)(note.id, content, fname);
                    (0, database_1.updateNoteFilePath)(note.id, pathSaved);
                    try {
                        (0, database_1.upsertNoteFts)(note.id, title, content);
                    }
                    catch (_c) {
                        void 0;
                    }
                    try {
                        (0, database_1.addTagToNote)(note.id, 'report', 0);
                    }
                    catch (_d) {
                        void 0;
                    }
                }
                catch (err) {
                    console.warn('[main] failed to create sync report', err);
                }
                return res;
            }
            catch (err) {
                console.warn('[main] trigger-sync failed', err);
                return { createdNoteIds: [], updatedPaths: [], markedDeletedNoteIds: [] };
            }
        }));
        electron_1.ipcMain.handle('import-folder', (event) => __awaiter(void 0, void 0, void 0, function* () {
            var _a, _b, _c, _d;
            try {
                const win = (_b = (_a = electron_1.BrowserWindow.fromWebContents(event.sender)) !== null && _a !== void 0 ? _a : mainWindow) !== null && _b !== void 0 ? _b : undefined;
                const res = yield electron_1.dialog.showOpenDialog(win, { properties: ['openDirectory'] });
                if (!res || res.canceled || !res.filePaths || res.filePaths.length === 0)
                    return { imported: 0, createdNoteIds: [] };
                const folder = res.filePaths[0];
                const entries = fs.readdirSync(folder).filter(f => f.toLowerCase().endsWith('.md') || f.toLowerCase().endsWith('.txt'));
                const createdNoteIds = [];
                const errors = [];
                for (const e of entries) {
                    try {
                        const src = path.join(folder, e);
                        const stat = fs.statSync(src);
                        const mtime = stat.mtime;
                        const createdIso = mtime.toISOString();
                        // create DB entry
                        const titleGuess = (() => {
                            try {
                                const raw = fs.readFileSync(src, 'utf8');
                                const lines = raw.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
                                if (lines.length > 0)
                                    return lines[0].replace(/^#+\s*/, '') || e.replace(/\.(md|txt)$/i, '');
                            }
                            catch (_a) {
                                void 0;
                            }
                            return e.replace(/\.(md|txt)$/i, '');
                        })();
                        const note = (0, database_1.createNote)(titleGuess, '');
                        // generate token and filename
                        const token = (0, database_1.generateUniqueFileToken)();
                        try {
                            (0, database_1.setNoteFileToken)(note.id, token);
                        }
                        catch (err) {
                            console.warn('[main] setNoteFileToken failed during import', err);
                        }
                        // set createdAt to file mtime
                        try {
                            (0, database_1.updateNoteCreatedAt)(note.id, createdIso);
                        }
                        catch (err) {
                            console.warn('[main] updateNoteCreatedAt failed during import', err);
                        }
                        try {
                            (0, database_1.updateNoteLastEdited)(note.id, createdIso);
                        }
                        catch (err) {
                            console.warn('[main] updateNoteLastEdited failed during import', err);
                        }
                        const d = new Date(createdIso);
                        const yy = String(d.getFullYear()).slice(-2);
                        const mm = String(d.getMonth() + 1).padStart(2, '0');
                        const dd = String(d.getDate()).padStart(2, '0');
                        const hh = String(d.getHours()).padStart(2, '0');
                        const min = String(d.getMinutes()).padStart(2, '0');
                        const fname = `${yy}-${mm}-${dd}_${hh}-${min}_${token}.md`;
                        const dest = yield (0, fileSystem_1.copyFileToNotes)(src, fname);
                        (0, database_1.updateNoteFilePath)(note.id, dest);
                        // index content
                        try {
                            const content = fs.readFileSync(dest, 'utf8');
                            (0, database_1.upsertNoteFts)(note.id, note.title, content);
                        }
                        catch (err) { /* non fatal */ }
                        createdNoteIds.push(note.id);
                    }
                    catch (err) {
                        errors.push(String((_c = err === null || err === void 0 ? void 0 : err.message) !== null && _c !== void 0 ? _c : err));
                    }
                }
                const result = { imported: createdNoteIds.length, createdNoteIds, errors };
                // create a report note for import
                try {
                    const title = 'Report: Import';
                    const note = (0, database_1.createNote)(title, '');
                    const token = (0, database_1.generateUniqueFileToken)();
                    try {
                        (0, database_1.setNoteFileToken)(note.id, token);
                    }
                    catch (err) {
                        console.warn('[main] setNoteFileToken failed for import report', err);
                    }
                    const nowIso = new Date().toISOString();
                    try {
                        (0, database_1.updateNoteCreatedAt)(note.id, nowIso);
                    }
                    catch (_e) {
                        void 0;
                    }
                    try {
                        (0, database_1.updateNoteLastEdited)(note.id, nowIso);
                    }
                    catch (_f) {
                        void 0;
                    }
                    const parts = [];
                    parts.push(`# ${title}`);
                    parts.push(`**Time:** ${nowIso}`);
                    parts.push('');
                    parts.push(`- Imported files: ${result.imported}`);
                    if (result.createdNoteIds.length) {
                        parts.push('');
                        parts.push('### Created Note IDs');
                        for (const id of result.createdNoteIds)
                            parts.push(`- ${id}`);
                    }
                    if (result.errors && result.errors.length) {
                        parts.push('');
                        parts.push('### Errors');
                        for (const er of result.errors)
                            parts.push(`- ${er}`);
                    }
                    const content = parts.join('\n');
                    const d = new Date(nowIso);
                    const yy = String(d.getFullYear()).slice(-2);
                    const mm = String(d.getMonth() + 1).padStart(2, '0');
                    const dd = String(d.getDate()).padStart(2, '0');
                    const hh = String(d.getHours()).padStart(2, '0');
                    const min = String(d.getMinutes()).padStart(2, '0');
                    const fname = `${yy}-${mm}-${dd}_${hh}-${min}_${token}.md`;
                    const pathSaved = yield (0, fileSystem_1.saveNoteContent)(note.id, content, fname);
                    (0, database_1.updateNoteFilePath)(note.id, pathSaved);
                    try {
                        (0, database_1.upsertNoteFts)(note.id, title, content);
                    }
                    catch (_g) {
                        void 0;
                    }
                    try {
                        (0, database_1.addTagToNote)(note.id, 'report', 0);
                    }
                    catch (_h) {
                        void 0;
                    }
                }
                catch (err) {
                    console.warn('[main] failed to create import report', err);
                }
                return result;
            }
            catch (err) {
                console.warn('[main] import-folder failed', err);
                return { imported: 0, createdNoteIds: [], errors: [(_d = err === null || err === void 0 ? void 0 : err.message) !== null && _d !== void 0 ? _d : String(err)] };
            }
        }));
        electron_1.ipcMain.handle('purge-trash', () => __awaiter(void 0, void 0, void 0, function* () {
            var _a, _b;
            const purgedNoteIds = [];
            const errors = [];
            try {
                const trash = (0, database_1.getNotesInTrash)();
                for (const n of trash) {
                    try {
                        yield (0, fileSystem_1.deleteNoteFile)(n.filePath);
                        (0, database_1.deleteNote)(n.id);
                        try {
                            (0, database_1.removeNoteFts)(n.id);
                        }
                        catch (err) { /* non-fatal */ }
                        purgedNoteIds.push(n.id);
                    }
                    catch (err) {
                        errors.push(String((_a = err === null || err === void 0 ? void 0 : err.message) !== null && _a !== void 0 ? _a : err));
                    }
                }
            }
            catch (err) {
                errors.push(String((_b = err === null || err === void 0 ? void 0 : err.message) !== null && _b !== void 0 ? _b : err));
            }
            const result = { purgedNoteIds, errors };
            return result;
        }));
        electron_1.ipcMain.handle('get-last-edited-note', () => __awaiter(void 0, void 0, void 0, function* () { var _a; return (_a = (0, database_1.getLastEditedNote)()) !== null && _a !== void 0 ? _a : null; }));
        electron_1.ipcMain.handle('save-note-ui-state', (_event, noteId, state) => __awaiter(void 0, void 0, void 0, function* () {
            if (!isPositiveInteger(noteId) || typeof state !== 'object' || state === null)
                throw new Error('Invalid args');
            const s = state;
            try {
                (0, database_1.saveNoteUiState)(Number(noteId), s);
            }
            catch (err) {
                console.warn('[main] saveNoteUiState failed', err);
            }
        }));
        electron_1.ipcMain.handle('get-note-ui-state', (_event, noteId) => __awaiter(void 0, void 0, void 0, function* () {
            if (!isPositiveInteger(noteId))
                throw new Error('Invalid args');
            try {
                return (0, database_1.getNoteUiState)(Number(noteId));
            }
            catch (err) {
                console.warn('[main] getNoteUiState failed', err);
                return { progressPreview: null, progressEdit: null, cursorPos: null, scrollTop: null };
            }
        }));
        // request-force-save: send do-force-save with requestId to focused window and wait for completion or timeout
        electron_1.ipcMain.handle('request-force-save', () => __awaiter(void 0, void 0, void 0, function* () {
            var _a;
            try {
                const focused = (_a = electron_1.BrowserWindow.getFocusedWindow()) !== null && _a !== void 0 ? _a : mainWindow;
                if (!focused || !focused.webContents) {
                    return { ok: true }; // nothing to do
                }
                const requestId = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
                const webContentsId = focused.webContents.id;
                // send request
                focused.webContents.send('do-force-save', requestId);
                // wait for completion with timeout
                const p = new Promise((resolve) => {
                    const timer = setTimeout(() => {
                        // timeout - resolve false but still remove from map
                        pendingForceSaves.delete(requestId);
                        resolve({ ok: false });
                    }, 2000);
                    pendingForceSaves.set(requestId, {
                        webContentsId,
                        resolve: (ok) => resolve({ ok }),
                        timer,
                    });
                });
                return yield p;
            }
            catch (err) {
                console.warn('[main] request-force-save failed', err);
                return { ok: false };
            }
        }));
        electron_1.ipcMain.handle('set-spellchecker-languages', (_event, langs) => __awaiter(void 0, void 0, void 0, function* () {
            if (!isStringArray(langs))
                throw new Error('Invalid langs array');
            try {
                yield setDefaultSpellCheckerLanguages(langs);
                return { ok: true };
            }
            catch (err) {
                return { ok: false, error: String(err) };
            }
        }));
        console.log('[main] IPC handlers registered');
    }
    catch (err) {
        console.error('[main] error registering IPC handlers', err && err.stack ? err.stack : err);
        throw err;
    }
    createWindow();
    electron_1.app.on('activate', () => {
        if (electron_1.BrowserWindow.getAllWindows().length === 0)
            createWindow();
    });
})).catch(err => {
    console.error('[main] whenReady threw', err && err.stack ? err.stack : err);
    throw err;
});
electron_1.app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        try {
            (0, database_1.closeDatabase)();
        }
        catch (err) {
            console.error('[main] closeDatabase error', err);
        }
        electron_1.app.quit();
    }
});
electron_1.app.on('before-quit', () => {
    try {
        (0, database_1.closeDatabase)();
    }
    catch (err) {
        console.error('[main] closeDatabase error', err);
    }
});


/***/ },

/***/ "./src/main/database.ts"
/*!******************************!*\
  !*** ./src/main/database.ts ***!
  \******************************/
(__unused_webpack_module, exports, __webpack_require__) {

"use strict";

var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.initDatabase = initDatabase;
exports.createNote = createNote;
exports.createTempNote = createTempNote;
exports.updateTempNoteState = updateTempNoteState;
exports.convertTempNoteToRegular = convertTempNoteToRegular;
exports.getTempNotes = getTempNotes;
exports.deleteTempNote = deleteTempNote;
exports.getNoteByToken = getNoteByToken;
exports.setNoteFileToken = setNoteFileToken;
exports.generateUniqueFileToken = generateUniqueFileToken;
exports.updateNoteCreatedAt = updateNoteCreatedAt;
exports.updateNoteLastEdited = updateNoteLastEdited;
exports.getAllNotes = getAllNotes;
exports.getNoteById = getNoteById;
exports.getNoteUiState = getNoteUiState;
exports.saveNoteUiState = saveNoteUiState;
exports.updateNote = updateNote;
exports.updateNoteTitle = updateNoteTitle;
exports.updateNoteFilePath = updateNoteFilePath;
exports.deleteNote = deleteNote;
exports.getLastEditedNote = getLastEditedNote;
exports.closeDatabase = closeDatabase;
exports.getNotesPage = getNotesPage;
exports.createOrGetTag = createOrGetTag;
exports.renameTag = renameTag;
exports.addTagToNote = addTagToNote;
exports.removeTagFromNote = removeTagFromNote;
exports.reorderNoteTags = reorderNoteTags;
exports.getNoteTags = getNoteTags;
exports.getAllTags = getAllTags;
exports.getTopTags = getTopTags;
exports.upsertNoteFts = upsertNoteFts;
exports.removeNoteFts = removeNoteFts;
exports.searchNotes = searchNotes;
exports.searchNotesByTag = searchNotesByTag;
exports.getNotesByPrimaryTag = getNotesByPrimaryTag;
exports.getCategoryHierarchy = getCategoryHierarchy;
exports.getHierarchyForTag = getHierarchyForTag;
exports.getNotesInTrash = getNotesInTrash;
exports.reconcileNotesWithFs = reconcileNotesWithFs;
exports.saveNoteSnapshot = saveNoteSnapshot;
exports.getNoteSnapshots = getNoteSnapshots;
exports.deleteNoteSnapshot = deleteNoteSnapshot;
const better_sqlite3_1 = __importDefault(__webpack_require__(/*! better-sqlite3 */ "./node_modules/better-sqlite3/lib/index.js"));
const fs = __importStar(__webpack_require__(/*! fs/promises */ "fs/promises"));
const path = __importStar(__webpack_require__(/*! path */ "path"));
const paths_1 = __webpack_require__(/*! ./paths */ "./src/main/paths.ts");
let db;
const PROTECTED_TAGS = new Set(['deleted', 'archived']);
// Initialize database schema
function initDatabase() {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            yield fs.mkdir((0, paths_1.getDataDir)(), { recursive: true });
        }
        catch (error) {
            throw new Error(`Failed to create data directory: ${error instanceof Error ? error.message : String(error)}`);
        }
        db = new better_sqlite3_1.default((0, paths_1.getDbPath)());
        db.exec(`
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS notes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      filePath TEXT NOT NULL,
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL,
      lastEdited TEXT
    );

    CREATE TABLE IF NOT EXISTS tags (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE NOT NULL
    );

    CREATE TABLE IF NOT EXISTS note_tags (
      noteId INTEGER NOT NULL,
      tagId INTEGER NOT NULL,
      position INTEGER NOT NULL,
      PRIMARY KEY (noteId, tagId),
      FOREIGN KEY (noteId) REFERENCES notes(id) ON DELETE CASCADE,
      FOREIGN KEY (tagId) REFERENCES tags(id)
    );

    CREATE INDEX IF NOT EXISTS idx_note_tags_note ON note_tags(noteId);
    CREATE INDEX IF NOT EXISTS idx_note_tags_tag ON note_tags(tagId);

    CREATE TABLE IF NOT EXISTS note_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      noteId INTEGER NOT NULL,
      content TEXT NOT NULL,
      timestamp TEXT NOT NULL,
      isManual INTEGER DEFAULT 0,
      FOREIGN KEY (noteId) REFERENCES notes(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_note_snapshots_note ON note_snapshots(noteId);
  `);
        // Ensure UI state columns exist on `notes` table. Use a migration-friendly approach
        try {
            const cols = db.prepare("PRAGMA table_info(notes)").all();
            const names = new Set(cols.map(c => String(c.name)));
            if (!names.has('progressPreview'))
                db.prepare('ALTER TABLE notes ADD COLUMN progressPreview REAL DEFAULT 0').run();
            if (!names.has('progressEdit'))
                db.prepare('ALTER TABLE notes ADD COLUMN progressEdit REAL DEFAULT 0').run();
            if (!names.has('cursorPos'))
                db.prepare('ALTER TABLE notes ADD COLUMN cursorPos INTEGER DEFAULT 0').run();
            if (!names.has('scrollTop'))
                db.prepare('ALTER TABLE notes ADD COLUMN scrollTop REAL DEFAULT 0').run();
            if (!names.has('editHistory'))
                db.prepare('ALTER TABLE notes ADD COLUMN editHistory TEXT').run();
            // Temp note fields
            if (!names.has('isTemp'))
                db.prepare('ALTER TABLE notes ADD COLUMN isTemp INTEGER DEFAULT 0').run();
            if (!names.has('externalPath'))
                db.prepare('ALTER TABLE notes ADD COLUMN externalPath TEXT').run();
            if (!names.has('hasUnsavedChanges'))
                db.prepare('ALTER TABLE notes ADD COLUMN hasUnsavedChanges INTEGER DEFAULT 0').run();
            if (!names.has('syncMode'))
                db.prepare('ALTER TABLE notes ADD COLUMN syncMode INTEGER DEFAULT 0').run();
            if (!names.has('originalEncoding'))
                db.prepare('ALTER TABLE notes ADD COLUMN originalEncoding TEXT').run();
            const snapCols = db.prepare("PRAGMA table_info(note_snapshots)").all();
            const snapNames = new Set(snapCols.map(c => String(c.name)));
            if (!snapNames.has('isManual'))
                db.prepare('ALTER TABLE note_snapshots ADD COLUMN isManual INTEGER DEFAULT 0').run();
        }
        catch (merr) {
            console.warn('[db] UI-state migration check failed', merr);
        }
        try {
            db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS notes_fts USING fts5(
        noteId UNINDEXED,
        title,
        content
      );
    `);
        }
        catch (err) {
            console.error('[db] Failed to create FTS table; FTS5 may be unavailable', err);
            throw err;
        }
        // Ensure `fileToken` column exists and a unique index enforces uniqueness
        try {
            const cols2 = db.prepare("PRAGMA table_info(notes)").all();
            const names2 = new Set(cols2.map(c => String(c.name)));
            if (!names2.has('fileToken')) {
                db.prepare('ALTER TABLE notes ADD COLUMN fileToken TEXT').run();
            }
            db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_notes_fileToken ON notes(fileToken);");
        }
        catch (err) {
            console.warn('[db] fileToken migration failed', err);
        }
    });
}
/* Utilities */
function normalizeTagName(name) {
    return name.trim().toLowerCase().replace(/\s+/g, '-');
}
function escapeRegExp(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
/* Core note operations */
function createNote(title, filePath) {
    const now = new Date().toISOString();
    const stmt = db.prepare(`
    INSERT INTO notes (title, filePath, createdAt, updatedAt, lastEdited)
    VALUES (?, ?, ?, ?, ?)
  `);
    // Ensure protected tags exist
    try {
        // createOrGetTag is declared below; call via normalized names after it's available
        // We'll lazily ensure tags exist after function definitions by calling here is not safe,
        // so instead ensure at end of initDatabase by creating them directly via SQL if absent.
        const existing = db.prepare('SELECT name FROM tags WHERE name IN (?, ?, ?)').all('deleted', 'archived', 'temp');
        const found = new Set(existing.map(r => r.name));
        if (!found.has('deleted'))
            db.prepare('INSERT INTO tags (name) VALUES (?)').run('deleted');
        if (!found.has('archived'))
            db.prepare('INSERT INTO tags (name) VALUES (?)').run('archived');
        if (!found.has('temp'))
            db.prepare('INSERT INTO tags (name) VALUES (?)').run('temp');
    }
    catch (err) {
        console.warn('[db] ensure protected tags failed', err);
    }
    const result = stmt.run(title, filePath, now, now, now);
    // Ensure freshly-created notes have no persisted cursor/scroll state
    try {
        db.prepare('UPDATE notes SET cursorPos = NULL, scrollTop = NULL WHERE id = ?').run(result.lastInsertRowid);
    }
    catch (err) {
        // non-fatal - leave as-is if the update fails
    }
    return {
        id: result.lastInsertRowid,
        title,
        filePath,
        createdAt: now,
        updatedAt: now,
        lastEdited: now,
    };
}
function createTempNote(title, externalPath, originalEncoding) {
    const now = new Date().toISOString();
    const stmt = db.prepare(`
    INSERT INTO notes (title, filePath, createdAt, updatedAt, lastEdited, isTemp, externalPath, hasUnsavedChanges, syncMode, originalEncoding)
    VALUES (?, ?, ?, ?, ?, 1, ?, 0, 0, ?)
  `);
    const result = stmt.run(title, externalPath, now, now, now, externalPath, originalEncoding || 'utf8');
    return {
        id: result.lastInsertRowid,
        title,
        filePath: externalPath, // Use external path as filePath for consistency
        createdAt: now,
        updatedAt: now,
        lastEdited: now,
        isTemp: true,
        externalPath,
        hasUnsavedChanges: false,
        syncMode: false,
        originalEncoding: originalEncoding || 'utf8',
    };
}
function updateTempNoteState(noteId, hasUnsavedChanges, syncMode) {
    const stmt = db.prepare(`
    UPDATE notes 
    SET hasUnsavedChanges = ?, syncMode = ?, updatedAt = ?
    WHERE id = ? AND isTemp = 1
  `);
    stmt.run(hasUnsavedChanges ? 1 : 0, syncMode ? 1 : 0, new Date().toISOString(), noteId);
}
function convertTempNoteToRegular(noteId, newFilePath) {
    const stmt = db.prepare(`
    UPDATE notes 
    SET isTemp = 0, externalPath = NULL, hasUnsavedChanges = 0, syncMode = 0, 
        filePath = ?, updatedAt = ?, originalEncoding = NULL
    WHERE id = ? AND isTemp = 1
  `);
    stmt.run(newFilePath, new Date().toISOString(), noteId);
}
function getTempNotes() {
    const stmt = db.prepare('SELECT * FROM notes WHERE isTemp = 1 ORDER BY lastEdited DESC');
    return stmt.all();
}
function deleteTempNote(noteId) {
    // Only delete if it's a temp note
    const stmt = db.prepare('DELETE FROM notes WHERE id = ? AND isTemp = 1');
    stmt.run(noteId);
}
function getNoteByToken(token) {
    const stmt = db.prepare('SELECT * FROM notes WHERE fileToken = ?');
    return stmt.get(token);
}
function setNoteFileToken(noteId, token) {
    db.prepare('UPDATE notes SET fileToken = ? WHERE id = ?').run(token, noteId);
}
function generateUniqueFileToken() {
    const alpha = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    for (let attempt = 0; attempt < 10000; attempt++) {
        let t = '';
        for (let i = 0; i < 9; i++)
            t += alpha[Math.floor(Math.random() * alpha.length)];
        const exists = db.prepare('SELECT 1 FROM notes WHERE fileToken = ?').get(t);
        if (!exists)
            return t;
    }
    throw new Error('Failed to generate unique file token after many attempts');
}
function updateNoteCreatedAt(noteId, iso) {
    db.prepare('UPDATE notes SET createdAt = ? WHERE id = ?').run(iso, noteId);
}
function updateNoteLastEdited(noteId, iso) {
    db.prepare('UPDATE notes SET lastEdited = ? WHERE id = ?').run(iso, noteId);
}
function getAllNotes() {
    const stmt = db.prepare('SELECT * FROM notes ORDER BY updatedAt DESC');
    return stmt.all();
}
function getNoteById(id) {
    const stmt = db.prepare('SELECT * FROM notes WHERE id = ?');
    return stmt.get(id);
}
function getNoteUiState(noteId) {
    const stmt = db.prepare('SELECT progressPreview, progressEdit, cursorPos, scrollTop FROM notes WHERE id = ?');
    const row = stmt.get(noteId);
    if (!row)
        return { progressPreview: null, progressEdit: null, cursorPos: null, scrollTop: null };
    return {
        progressPreview: row.progressPreview == null ? null : Number(row.progressPreview),
        progressEdit: row.progressEdit == null ? null : Number(row.progressEdit),
        cursorPos: row.cursorPos == null ? null : Number(row.cursorPos),
        scrollTop: row.scrollTop == null ? null : Number(row.scrollTop),
    };
}
function saveNoteUiState(noteId, state) {
    const parts = [];
    const values = [];
    if (state.progressPreview !== undefined) {
        parts.push('progressPreview = ?');
        values.push(state.progressPreview);
    }
    if (state.progressEdit !== undefined) {
        parts.push('progressEdit = ?');
        values.push(state.progressEdit);
    }
    if (state.cursorPos !== undefined) {
        parts.push('cursorPos = ?');
        values.push(state.cursorPos);
    }
    if (state.scrollTop !== undefined) {
        parts.push('scrollTop = ?');
        values.push(state.scrollTop);
    }
    if (parts.length === 0)
        return;
    const sql = `UPDATE notes SET ${parts.join(', ')} WHERE id = ?`;
    values.push(noteId);
    db.prepare(sql).run(...values);
}
function updateNote(id) {
    const now = new Date().toISOString();
    const stmt = db.prepare('UPDATE notes SET updatedAt = ?, lastEdited = ? WHERE id = ?');
    stmt.run(now, now, id);
}
function updateNoteTitle(id, title) {
    const now = new Date().toISOString();
    const stmt = db.prepare('UPDATE notes SET title = ?, updatedAt = ? WHERE id = ?');
    stmt.run(title, now, id);
}
function updateNoteFilePath(id, filePath) {
    const stmt = db.prepare('UPDATE notes SET filePath = ? WHERE id = ?');
    stmt.run(filePath, id);
}
function deleteNote(id) {
    const stmt = db.prepare('DELETE FROM notes WHERE id = ?');
    stmt.run(id);
    try {
        removeNoteFts(id);
    }
    catch (err) {
        console.warn('[db] removeNoteFts failed', err);
    }
}
function getLastEditedNote() {
    const stmt = db.prepare('SELECT * FROM notes WHERE lastEdited IS NOT NULL ORDER BY lastEdited DESC LIMIT 1');
    return stmt.get();
}
function closeDatabase() {
    db.close();
}
/* Pagination */
function getNotesPage(page, perPage) {
    const offset = (page - 1) * perPage;
    const notesStmt = db.prepare(`
    SELECT n.*, t0.name as primaryTag
    FROM notes n
    LEFT JOIN note_tags nt0 ON n.id = nt0.noteId AND nt0.position = 0
    LEFT JOIN tags t0 ON nt0.tagId = t0.id
    WHERE t0.name IS NULL OR LOWER(t0.name) NOT IN ('deleted', 'archived')
    ORDER BY n.updatedAt DESC
    LIMIT ? OFFSET ?
  `);
    const countStmt = db.prepare(`
    SELECT COUNT(*) as count
    FROM notes n
    LEFT JOIN note_tags nt0 ON n.id = nt0.noteId AND nt0.position = 0
    LEFT JOIN tags t0 ON nt0.tagId = t0.id
    WHERE t0.name IS NULL OR LOWER(t0.name) NOT IN ('deleted', 'archived')
  `);
    const notes = notesStmt.all(perPage, offset);
    const result = countStmt.get();
    return { notes, total: result.count };
}
/* Tags */
function createOrGetTag(name) {
    const normalized = normalizeTagName(name);
    const existing = db.prepare('SELECT * FROM tags WHERE name = ?').get(normalized);
    if (existing)
        return existing;
    const stmt = db.prepare('INSERT INTO tags (name) VALUES (?)');
    const result = stmt.run(normalized);
    return { id: result.lastInsertRowid, name: normalized };
}
function renameTag(tagId, newName) {
    const normalized = normalizeTagName(newName);
    const existingTag = db.prepare('SELECT * FROM tags WHERE id = ?').get(tagId);
    if (!existingTag)
        throw new Error('Tag not found');
    // Prevent renaming protected tags
    if (PROTECTED_TAGS.has(existingTag.name)) {
        throw new Error('This tag is protected and cannot be renamed');
    }
    const conflict = db.prepare('SELECT * FROM tags WHERE name = ?').get(normalized);
    if (conflict && conflict.id !== tagId) {
        // Merge: point note_tags to the conflict.id where no duplicate exists, then remove old tag rows
        const updateStmt = db.prepare(`
      UPDATE note_tags
      SET tagId = ?
      WHERE tagId = ? AND NOT EXISTS (
        SELECT 1 FROM note_tags nt2 WHERE nt2.noteId = note_tags.noteId AND nt2.tagId = ?
      )
    `);
        updateStmt.run(conflict.id, tagId, conflict.id);
        // remove any remaining old tag references
        db.prepare('DELETE FROM note_tags WHERE tagId = ?').run(tagId);
        // remove the old tag row
        db.prepare('DELETE FROM tags WHERE id = ?').run(tagId);
    }
    else {
        db.prepare('UPDATE tags SET name = ? WHERE id = ?').run(normalized, tagId);
    }
}
function addTagToNote(noteId, tagName, position) {
    const tag = createOrGetTag(tagName);
    // If adding a protected tag, force it to primary (position 0) and shift existing positions up.
    if (PROTECTED_TAGS.has(tag.name)) {
        position = 0;
    }
    // If inserting at primary (position 0), shift existing positions up to make room.
    if (position === 0) {
        db.prepare('UPDATE note_tags SET position = position + 1 WHERE noteId = ?').run(noteId);
    }
    // Remove any existing relation for this tag (safe)
    db.prepare('DELETE FROM note_tags WHERE noteId = ? AND tagId = ?').run(noteId, tag.id);
    // If adding a protected tag, remove the other protected tag(s) from this note to enforce mutual exclusion
    if (PROTECTED_TAGS.has(tag.name)) {
        for (const other of PROTECTED_TAGS) {
            if (other === tag.name)
                continue;
            const otherRow = db.prepare('SELECT id FROM tags WHERE name = ?').get(other);
            if (otherRow)
                db.prepare('DELETE FROM note_tags WHERE noteId = ? AND tagId = ?').run(noteId, otherRow.id);
        }
    }
    db.prepare('INSERT INTO note_tags (noteId, tagId, position) VALUES (?, ?, ?)').run(noteId, tag.id, position);
    // Re-normalize positions to 0..n-1 in current order
    const rows = db.prepare('SELECT tagId FROM note_tags WHERE noteId = ? ORDER BY position').all(noteId);
    rows.forEach((r, idx) => {
        db.prepare('UPDATE note_tags SET position = ? WHERE noteId = ? AND tagId = ?').run(idx, noteId, r.tagId);
    });
    return { noteId, tagId: tag.id, position: rows.findIndex(r => r.tagId === tag.id), tag };
}
function removeTagFromNote(noteId, tagId) {
    db.prepare('DELETE FROM note_tags WHERE noteId = ? AND tagId = ?').run(noteId, tagId);
    const tags = db.prepare('SELECT * FROM note_tags WHERE noteId = ? ORDER BY position').all(noteId);
    tags.forEach((tag, index) => {
        db.prepare('UPDATE note_tags SET position = ? WHERE noteId = ? AND tagId = ?').run(index, noteId, tag.tagId);
    });
}
function reorderNoteTags(noteId, tagIds) {
    // Ensure protected tags (deleted/archived) remain at position 0 if present.
    let newOrder = [...tagIds];
    try {
        const protNames = Array.from(PROTECTED_TAGS);
        if (protNames.length > 0) {
            const placeholders = protNames.map(() => '?').join(',');
            const rows = db.prepare(`SELECT id, name FROM tags WHERE LOWER(name) IN (${placeholders})`).all(...protNames);
            const protIdSet = new Set(rows.map(r => r.id));
            // Build a new order: any protected tag ids (in the order they appear in protNames/rows)
            const protIdsInRequest = [];
            for (const r of rows) {
                if (newOrder.includes(r.id))
                    protIdsInRequest.push(r.id);
            }
            if (protIdsInRequest.length > 0) {
                // Remove protected ids from their current positions
                newOrder = newOrder.filter(id => !protIdSet.has(id));
                // Insert protected ids at the front in the same order
                newOrder = [...protIdsInRequest, ...newOrder];
            }
        }
    }
    catch (err) {
        // Non-fatal - if anything goes wrong, fall back to provided order
        console.warn('[db] reorderNoteTags protected-tag reorder failed', err);
        newOrder = [...tagIds];
    }
    newOrder.forEach((tagId, index) => {
        db.prepare('UPDATE note_tags SET position = ? WHERE noteId = ? AND tagId = ?').run(index, noteId, tagId);
    });
}
function getNoteTags(noteId) {
    const stmt = db.prepare(`
    SELECT nt.noteId, nt.tagId, nt.position, t.id, t.name
    FROM note_tags nt
    JOIN tags t ON nt.tagId = t.id
    WHERE nt.noteId = ?
    ORDER BY nt.position
  `);
    const rows = stmt.all(noteId);
    return rows.map(row => ({
        noteId: row.noteId,
        tagId: row.tagId,
        position: row.position,
        tag: { id: row.id, name: row.name }
    }));
}
function getAllTags() {
    const stmt = db.prepare('SELECT * FROM tags ORDER BY name');
    return stmt.all();
}
function getTopTags(limit) {
    const cutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
    const stmt = db.prepare(`
    SELECT t.id, t.name, COUNT(nt.noteId) as usage_count
    FROM tags t
    JOIN note_tags nt ON t.id = nt.tagId
    JOIN notes n ON nt.noteId = n.id
    WHERE (n.updatedAt >= ? OR n.createdAt >= ? OR (n.lastEdited IS NOT NULL AND n.lastEdited >= ?))
      AND LOWER(t.name) NOT IN ('deleted', 'archived')
    GROUP BY t.id
    HAVING usage_count > 0
    ORDER BY usage_count DESC, t.name
    LIMIT ?
  `);
    return stmt.all(cutoff, cutoff, cutoff, limit);
}
/* FTS helpers */
function upsertNoteFts(noteId, title, content) {
    const idStr = String(noteId);
    db.prepare('DELETE FROM notes_fts WHERE noteId = ?').run(idStr);
    db.prepare('INSERT INTO notes_fts(noteId, title, content) VALUES (?, ?, ?)').run(idStr, title, content);
}
function removeNoteFts(noteId) {
    const idStr = String(noteId);
    db.prepare('DELETE FROM notes_fts WHERE noteId = ?').run(idStr);
}
/* Phrase permissive check */
function phraseMatchesPermissive(content, phrase) {
    if (!phrase)
        return false;
    const tokens = phrase.split(/\s+/).map(t => t.trim()).filter(Boolean).map(t => t.replace(/[^A-Za-z0-9_-]+/g, ''));
    if (tokens.length === 0)
        return false;
    const allButLast = tokens.slice(0, -1).map(t => escapeRegExp(t));
    const last = escapeRegExp(tokens[tokens.length - 1]);
    const prefix = allButLast.length ? allButLast.join('\\W+') + '\\W+' : '';
    const pattern = prefix + last + '\\w*';
    const re = new RegExp(pattern, 'i');
    return re.test(content);
}
/* Build FTS match expression (tokens required -> AND semantics). */
function buildFtsMatchExpression(query) {
    if (!query)
        return '';
    const phraseRegex = /"([^"]+)"/g;
    let m;
    const phraseTokens = [];
    while ((m = phraseRegex.exec(query)) !== null) {
        const phrase = m[1].trim();
        if (phrase) {
            const toks = phrase.split(/\s+/).map(t => t.trim().replace(/[^A-Za-z0-9_-]+/g, '')).filter(Boolean);
            for (const t of toks)
                phraseTokens.push(`${t}*`);
        }
    }
    const stripped = query.replace(phraseRegex, ' ');
    const tokens = stripped.split(/\s+/).map(t => t.trim()).filter(Boolean);
    const tokenParts = [];
    for (const raw of tokens) {
        const cleaned = raw.replace(/[^A-Za-z0-9_-]+/g, '');
        if (!cleaned)
            continue;
        tokenParts.push(`${cleaned}*`);
    }
    const parts = [...phraseTokens, ...tokenParts];
    if (parts.length === 0)
        return '';
    return parts.join(' AND ');
}
/* Search (FTS-backed, with post-filtering and snippet segments) */
function searchNotes(query) {
    return __awaiter(this, void 0, void 0, function* () {
        const trimmed = (query || '').trim();
        if (!trimmed)
            return [];
        const phraseRegex = /"([^"]+)"/g;
        let pm;
        const quotedPhrases = [];
        while ((pm = phraseRegex.exec(trimmed)) !== null) {
            const phrase = pm[1].trim();
            if (phrase)
                quotedPhrases.push(phrase);
        }
        const stripped = trimmed.replace(phraseRegex, ' ');
        const tokens = stripped.split(/\s+/).map(t => t.trim()).filter(Boolean);
        const tokenPatterns = tokens
            .map(t => t.replace(/[^A-Za-z0-9_-]+/g, ''))
            .filter(Boolean)
            .map(t => t.toLowerCase());
        const matchExpr = buildFtsMatchExpression(trimmed);
        if (!matchExpr)
            return [];
        const MAX_RESULTS = 200;
        // Try parameterized MATCH first (safer); if not supported, try inlined escaped expression.
        try {
            const stmtParam = db.prepare(`SELECT noteId FROM notes_fts WHERE notes_fts MATCH ? LIMIT ?`);
            const rows = stmtParam.all(matchExpr, MAX_RESULTS);
            const results = [];
            for (const r of rows) {
                const id = Number(r.noteId);
                if (Number.isNaN(id))
                    continue;
                const note = getNoteById(id);
                if (!note)
                    continue;
                let content = '';
                try {
                    content = yield fs.readFile(note.filePath, 'utf-8');
                }
                catch (_a) {
                    content = '';
                }
                const contentLower = content.toLowerCase();
                const titleLower = note.title.toLowerCase();
                let ok = true;
                for (const phrase of quotedPhrases) {
                    const inContent = content && phraseMatchesPermissive(content, phrase);
                    const inTitle = phrase && note.title && phraseMatchesPermissive(note.title, phrase);
                    if (!inContent && !inTitle) {
                        ok = false;
                        break;
                    }
                }
                if (!ok)
                    continue;
                for (const tp of tokenPatterns) {
                    if (!(contentLower.includes(tp) || titleLower.includes(tp))) {
                        ok = false;
                        break;
                    }
                }
                if (!ok)
                    continue;
                // Determine snippet center and build segments
                let firstIndex = -1;
                let firstMatchText = '';
                for (const phrase of quotedPhrases) {
                    if (!phrase)
                        continue;
                    const tokensP = phrase.split(/\s+/).map(t => t.replace(/[^A-Za-z0-9_-]+/g, '')).filter(Boolean);
                    if (tokensP.length === 0)
                        continue;
                    const reStr = tokensP.map(t => escapeRegExp(t)).join('\\W+');
                    const regex = new RegExp(reStr, 'i');
                    const m2 = regex.exec(content);
                    if (m2 && m2.index !== undefined) {
                        if (firstIndex === -1 || m2.index < firstIndex) {
                            firstIndex = m2.index;
                            firstMatchText = m2[0];
                        }
                    }
                }
                for (const t of tokenPatterns) {
                    const idx = contentLower.indexOf(t);
                    if (idx !== -1 && (firstIndex === -1 || idx < firstIndex)) {
                        firstIndex = idx;
                        firstMatchText = content.substr(idx, t.length);
                    }
                }
                if (firstIndex === -1) {
                    for (const phrase of quotedPhrases) {
                        const re = new RegExp(escapeRegExp(phrase), 'i');
                        const mt = re.exec(note.title);
                        if (mt && mt.index !== undefined) {
                            firstIndex = 0;
                            firstMatchText = mt[0];
                            break;
                        }
                    }
                    if (firstIndex === -1) {
                        for (const t of tokenPatterns) {
                            const idx = titleLower.indexOf(t);
                            if (idx !== -1) {
                                firstIndex = 0;
                                firstMatchText = note.title.substr(idx, t.length);
                                break;
                            }
                        }
                    }
                }
                const radius = 50;
                let snippetRaw = '';
                if (!content)
                    snippetRaw = note.title;
                else {
                    const centerPos = firstIndex >= 0 ? firstIndex : 0;
                    const start = Math.max(0, centerPos - radius);
                    const end = Math.min(content.length, centerPos + (firstMatchText ? firstMatchText.length : 0) + radius);
                    snippetRaw = content.substring(start, end);
                    if (start > 0)
                        snippetRaw = '...' + snippetRaw;
                    if (end < content.length)
                        snippetRaw = snippetRaw + '...';
                }
                const highlightItems = [];
                for (const p of quotedPhrases)
                    if (p)
                        highlightItems.push(p);
                for (const t of tokenPatterns)
                    if (t)
                        highlightItems.push(t);
                const uniqueHighlights = Array.from(new Set(highlightItems)).filter(Boolean).sort((a, b) => b.length - a.length);
                const segments = [];
                if (!snippetRaw)
                    segments.push({ text: '' });
                else if (uniqueHighlights.length === 0)
                    segments.push({ text: snippetRaw });
                else {
                    const alt = uniqueHighlights.map(h => escapeRegExp(h)).join('|');
                    const re = new RegExp(alt, 'ig');
                    let lastIndex = 0;
                    let m3;
                    while ((m3 = re.exec(snippetRaw)) !== null) {
                        const s = m3.index;
                        const e = re.lastIndex;
                        if (s > lastIndex)
                            segments.push({ text: snippetRaw.substring(lastIndex, s) });
                        segments.push({ text: snippetRaw.substring(s, e), highlight: true });
                        lastIndex = e;
                    }
                    if (lastIndex < snippetRaw.length)
                        segments.push({ text: snippetRaw.substring(lastIndex) });
                }
                const joinedQuery = (quotedPhrases.join(' ') + ' ' + tokenPatterns.join(' ')).trim().toLowerCase();
                const matchInTitle = note.title.toLowerCase().includes(joinedQuery);
                results.push({ note, matchType: matchInTitle ? 'title' : 'content', snippet: segments });
                if (results.length >= MAX_RESULTS)
                    break;
            }
            return results;
        }
        catch (paramErr) {
            // Fallback: attempt safe inline match, then final manual scan if necessary
            try {
                const safeMatch = matchExpr.replace(/'/g, "''").slice(0, 2000);
                const sql = `SELECT noteId FROM notes_fts WHERE notes_fts MATCH '${safeMatch}' LIMIT ${MAX_RESULTS}`;
                const stmt = db.prepare(sql);
                const rows = stmt.all();
                // reuse processing logic (kept concise here by delegating to above behavior)
                const results = [];
                for (const r of rows) {
                    const id = Number(r.noteId);
                    if (Number.isNaN(id))
                        continue;
                    const note = getNoteById(id);
                    if (!note)
                        continue;
                    let content = '';
                    try {
                        content = yield fs.readFile(note.filePath, 'utf-8');
                    }
                    catch (_b) {
                        content = '';
                    }
                    const contentLower = content.toLowerCase();
                    const titleLower = note.title.toLowerCase();
                    let ok = true;
                    for (const phrase of quotedPhrases) {
                        const inContent = content && phraseMatchesPermissive(content, phrase);
                        const inTitle = phrase && note.title && phraseMatchesPermissive(note.title, phrase);
                        if (!inContent && !inTitle) {
                            ok = false;
                            break;
                        }
                    }
                    if (!ok)
                        continue;
                    for (const tp of tokenPatterns) {
                        if (!(contentLower.includes(tp) || titleLower.includes(tp))) {
                            ok = false;
                            break;
                        }
                    }
                    if (!ok)
                        continue;
                    // Build snippet (same as above)...
                    let firstIndex = -1;
                    let firstMatchText = '';
                    for (const phrase of quotedPhrases) {
                        if (!phrase)
                            continue;
                        const tokensP = phrase.split(/\s+/).map(t => t.replace(/[^A-Za-z0-9_-]+/g, '')).filter(Boolean);
                        if (tokensP.length === 0)
                            continue;
                        const reStr = tokensP.map(t => escapeRegExp(t)).join('\\W+');
                        const regex = new RegExp(reStr, 'i');
                        const m2 = regex.exec(content);
                        if (m2 && m2.index !== undefined) {
                            if (firstIndex === -1 || m2.index < firstIndex) {
                                firstIndex = m2.index;
                                firstMatchText = m2[0];
                            }
                        }
                    }
                    for (const t of tokenPatterns) {
                        const idx = contentLower.indexOf(t);
                        if (idx !== -1 && (firstIndex === -1 || idx < firstIndex)) {
                            firstIndex = idx;
                            firstMatchText = content.substr(idx, t.length);
                        }
                    }
                    if (firstIndex === -1) {
                        for (const phrase of quotedPhrases) {
                            const re = new RegExp(escapeRegExp(phrase), 'i');
                            const mt = re.exec(note.title);
                            if (mt && mt.index !== undefined) {
                                firstIndex = 0;
                                firstMatchText = mt[0];
                                break;
                            }
                        }
                        if (firstIndex === -1) {
                            for (const t of tokenPatterns) {
                                const idx = titleLower.indexOf(t);
                                if (idx !== -1) {
                                    firstIndex = 0;
                                    firstMatchText = note.title.substr(idx, t.length);
                                    break;
                                }
                            }
                        }
                    }
                    const radius = 50;
                    let snippetRaw = '';
                    if (!content)
                        snippetRaw = note.title;
                    else {
                        const centerPos = firstIndex >= 0 ? firstIndex : 0;
                        const start = Math.max(0, centerPos - radius);
                        const end = Math.min(content.length, centerPos + (firstMatchText ? firstMatchText.length : 0) + radius);
                        snippetRaw = content.substring(start, end);
                        if (start > 0)
                            snippetRaw = '...' + snippetRaw;
                        if (end < content.length)
                            snippetRaw = snippetRaw + '...';
                    }
                    const highlightItems = [];
                    for (const p of quotedPhrases)
                        if (p)
                            highlightItems.push(p);
                    for (const t of tokenPatterns)
                        if (t)
                            highlightItems.push(t);
                    const uniqueHighlights = Array.from(new Set(highlightItems)).filter(Boolean).sort((a, b) => b.length - a.length);
                    const segments = [];
                    if (!snippetRaw)
                        segments.push({ text: '' });
                    else if (uniqueHighlights.length === 0)
                        segments.push({ text: snippetRaw });
                    else {
                        const alt = uniqueHighlights.map(h => escapeRegExp(h)).join('|');
                        const re = new RegExp(alt, 'ig');
                        let lastIndex = 0;
                        let m3;
                        while ((m3 = re.exec(snippetRaw)) !== null) {
                            const s = m3.index;
                            const e = re.lastIndex;
                            if (s > lastIndex)
                                segments.push({ text: snippetRaw.substring(lastIndex, s) });
                            segments.push({ text: snippetRaw.substring(s, e), highlight: true });
                            lastIndex = e;
                        }
                        if (lastIndex < snippetRaw.length)
                            segments.push({ text: snippetRaw.substring(lastIndex) });
                    }
                    const joinedQuery = (quotedPhrases.join(' ') + ' ' + tokenPatterns.join(' ')).trim().toLowerCase();
                    const matchInTitle = note.title.toLowerCase().includes(joinedQuery);
                    results.push({ note, matchType: matchInTitle ? 'title' : 'content', snippet: segments });
                    if (results.length >= MAX_RESULTS)
                        break;
                }
                return results;
            }
            catch (inlineErr) {
                console.error('[db] FTS inline match failed', inlineErr);
                // Final fallback: manual scan across all notes
                const phrasesFallback = [];
                const phraseRegexFallback = /"([^"]+)"/g;
                let pm2;
                while ((pm2 = phraseRegexFallback.exec(trimmed)) !== null) {
                    const phrase = pm2[1].trim();
                    if (phrase)
                        phrasesFallback.push(phrase);
                }
                const stripped2 = trimmed.replace(phraseRegexFallback, ' ');
                const tokensFallback = stripped2.split(/\s+/).map(t => t.trim()).filter(Boolean)
                    .map(t => t.replace(/[^A-Za-z0-9_-]+/g, '').toLowerCase())
                    .filter(Boolean);
                const allNotes = getAllNotes();
                const results = [];
                for (const note of allNotes) {
                    const content = yield (() => __awaiter(this, void 0, void 0, function* () {
                        try {
                            return yield fs.readFile(note.filePath, 'utf-8');
                        }
                        catch (_a) {
                            return '';
                        }
                    }))();
                    const contentLower = content.toLowerCase();
                    const titleLower = note.title.toLowerCase();
                    let ok = true;
                    for (const p of phrasesFallback) {
                        if (!(phraseMatchesPermissive(content, p) || phraseMatchesPermissive(note.title, p))) {
                            ok = false;
                            break;
                        }
                    }
                    if (!ok)
                        continue;
                    for (const t of tokensFallback) {
                        if (!(contentLower.includes(t) || titleLower.includes(t))) {
                            ok = false;
                            break;
                        }
                    }
                    if (!ok)
                        continue;
                    // snippet building
                    const firstIndexCandidates = [];
                    for (const p of phrasesFallback) {
                        const idx = contentLower.indexOf(p.toLowerCase());
                        if (idx !== -1)
                            firstIndexCandidates.push(idx);
                    }
                    for (const t of tokensFallback) {
                        const idx = contentLower.indexOf(t);
                        if (idx !== -1)
                            firstIndexCandidates.push(idx);
                    }
                    const firstIndex = firstIndexCandidates.length ? Math.min(...firstIndexCandidates) : -1;
                    const radius = 50;
                    let snippetRaw = '';
                    if (!content)
                        snippetRaw = note.title;
                    else {
                        const centerPos = firstIndex >= 0 ? firstIndex : 0;
                        const start = Math.max(0, centerPos - radius);
                        const end = Math.min(content.length, centerPos + radius);
                        snippetRaw = content.substring(start, end);
                        if (start > 0)
                            snippetRaw = '...' + snippetRaw;
                        if (end < content.length)
                            snippetRaw = snippetRaw + '...';
                    }
                    const highlights = [...phrasesFallback, ...tokensFallback].filter(Boolean).sort((a, b) => b.length - a.length);
                    const segments = [];
                    if (!snippetRaw)
                        segments.push({ text: '' });
                    else {
                        const alt = highlights.map(h => escapeRegExp(h)).join('|');
                        const re = new RegExp(alt, 'ig');
                        let lastIndex = 0;
                        let m3;
                        while ((m3 = re.exec(snippetRaw)) !== null) {
                            const s = m3.index;
                            const e = re.lastIndex;
                            if (s > lastIndex)
                                segments.push({ text: snippetRaw.substring(lastIndex, s) });
                            segments.push({ text: snippetRaw.substring(s, e), highlight: true });
                            lastIndex = e;
                        }
                        if (lastIndex < snippetRaw.length)
                            segments.push({ text: snippetRaw.substring(lastIndex) });
                    }
                    const joinedQuery = (phrasesFallback.join(' ') + ' ' + tokensFallback.join(' ')).trim().toLowerCase();
                    const matchInTitle = note.title.toLowerCase().includes(joinedQuery);
                    results.push({ note, matchType: matchInTitle ? 'title' : 'content', snippet: segments });
                    if (results.length >= MAX_RESULTS)
                        break;
                }
                return results;
            }
        }
    });
}
/* DB-only searches (tags / primary grouping) */
function searchNotesByTag(tagName) {
    const stmt = db.prepare(`
    SELECT n.*, nt.position
    FROM notes n
    JOIN note_tags nt ON n.id = nt.noteId
    JOIN tags t ON nt.tagId = t.id
    WHERE t.name LIKE ?
    ORDER BY nt.position, n.updatedAt DESC
  `);
    const notes = stmt.all(`%${tagName}%`);
    return notes.map(note => ({ note, matchType: 'tag' }));
}
function getNotesByPrimaryTag() {
    const stmt = db.prepare(`
    SELECT n.*, t.name as tagName
    FROM notes n
    JOIN note_tags nt ON n.id = nt.noteId
    JOIN tags t ON nt.tagId = t.id
    WHERE nt.position = 0
    ORDER BY t.name, n.updatedAt DESC
  `);
    const rows = stmt.all();
    const result = {};
    rows.forEach(row => {
        var _a;
        const tagName = row.tagName;
        const note = {
            id: row.id,
            title: row.title,
            filePath: row.filePath,
            createdAt: row.createdAt,
            updatedAt: row.updatedAt,
            lastEdited: (_a = row.lastEdited) !== null && _a !== void 0 ? _a : null
        };
        if (!result[tagName])
            result[tagName] = [];
        result[tagName].push(note);
    });
    return result;
}
function getCategoryHierarchy() {
    const stmt = db.prepare(`
    SELECT 
      n.id, n.title, n.filePath, n.createdAt, n.updatedAt, n.lastEdited,
      t0.name as primaryTag,
      t1.name as secondaryTag,
      t2.name as tertiaryTag
    FROM notes n
    LEFT JOIN note_tags nt0 ON n.id = nt0.noteId AND nt0.position = 0
    LEFT JOIN tags t0 ON nt0.tagId = t0.id
    LEFT JOIN note_tags nt1 ON n.id = nt1.noteId AND nt1.position = 1
    LEFT JOIN tags t1 ON nt1.tagId = t1.id
    LEFT JOIN note_tags nt2 ON n.id = nt2.noteId AND nt2.position = 2
    LEFT JOIN tags t2 ON nt2.tagId = t2.id
    WHERE NOT EXISTS (
      SELECT 1 FROM note_tags ntp
      JOIN tags tp ON ntp.tagId = tp.id
      WHERE ntp.noteId = n.id AND LOWER(tp.name) IN ('deleted', 'archived')
    )
    AND (n.isTemp IS NULL OR n.isTemp = 0)
    ORDER BY t0.name, t1.name, t2.name, n.updatedAt DESC
  `);
    const rows = stmt.all();
    const hierarchy = {};
    const uncategorizedNotes = [];
    rows.forEach(row => {
        var _a;
        const note = {
            id: row.id, title: row.title, filePath: row.filePath, createdAt: row.createdAt, updatedAt: row.updatedAt,
            lastEdited: (_a = row.lastEdited) !== null && _a !== void 0 ? _a : null
        };
        // Determine primary as the first non-protected tag among positions 0..2
        const positions = [row.primaryTag, row.secondaryTag, row.tertiaryTag].map(x => x == null ? null : String(x));
        let primary = null;
        let secondary = null;
        let tertiary = null;
        for (let i = 0; i < positions.length; i++) {
            const v = positions[i];
            if (!v)
                continue;
            if (!PROTECTED_TAGS.has(v) && primary == null) {
                primary = v;
                continue;
            }
            if (!v)
                continue;
            if (primary != null && secondary == null && !PROTECTED_TAGS.has(v)) {
                secondary = v;
                continue;
            }
            if (primary != null && secondary != null && tertiary == null && !PROTECTED_TAGS.has(v)) {
                tertiary = v;
            }
        }
        if (!primary) {
            uncategorizedNotes.push(note);
            return;
        }
        if (!hierarchy[primary])
            hierarchy[primary] = { notes: [], secondary: {} };
        if (!secondary) {
            hierarchy[primary].notes.push(note);
            return;
        }
        if (!hierarchy[primary].secondary[secondary])
            hierarchy[primary].secondary[secondary] = { notes: [], tertiary: {} };
        if (!tertiary) {
            hierarchy[primary].secondary[secondary].notes.push(note);
            return;
        }
        if (!hierarchy[primary].secondary[secondary].tertiary[tertiary])
            hierarchy[primary].secondary[secondary].tertiary[tertiary] = [];
        hierarchy[primary].secondary[secondary].tertiary[tertiary].push(note);
    });
    uncategorizedNotes.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
    // Reorder hierarchy keys so that normal tags (alphabetical) come first,
    // then 'archived' then 'deleted' (if present). This controls display order in the UI.
    // Exclude protected tags from the returned hierarchy (they are special menus)
    const orderedHierarchy = {};
    const keys = Object.keys(hierarchy).filter(Boolean).filter(k => !PROTECTED_TAGS.has(k));
    keys.sort((a, b) => a.localeCompare(b));
    for (const k of keys)
        orderedHierarchy[k] = hierarchy[k];
    return { hierarchy: orderedHierarchy, uncategorizedNotes };
}
function getHierarchyForTag(tagName) {
    const stmt = db.prepare(`
    SELECT 
      n.id, n.title, n.filePath, n.createdAt, n.updatedAt, n.lastEdited,
      t0.name as pos0,
      t1.name as pos1,
      t2.name as pos2
    FROM notes n
    JOIN note_tags nt_filter ON n.id = nt_filter.noteId
    JOIN tags tf ON nt_filter.tagId = tf.id
    LEFT JOIN note_tags nt0 ON n.id = nt0.noteId AND nt0.position = 0
    LEFT JOIN tags t0 ON nt0.tagId = t0.id
    LEFT JOIN note_tags nt1 ON n.id = nt1.noteId AND nt1.position = 1
    LEFT JOIN tags t1 ON nt1.tagId = t1.id
    LEFT JOIN note_tags nt2 ON n.id = nt2.noteId AND nt2.position = 2
    LEFT JOIN tags t2 ON nt2.tagId = t2.id
    WHERE tf.name = ?
    AND (n.isTemp IS NULL OR n.isTemp = 0)
    ORDER BY n.updatedAt DESC
  `);
    const rows = stmt.all(tagName);
    // Build hierarchy similar to getCategoryHierarchy but only for notes that have the tagName.
    const hierarchy = {};
    const uncategorizedNotes = [];
    rows.forEach(row => {
        var _a;
        const note = {
            id: row.id, title: row.title, filePath: row.filePath, createdAt: row.createdAt, updatedAt: row.updatedAt,
            lastEdited: (_a = row.lastEdited) !== null && _a !== void 0 ? _a : null
        };
        const positions = [row.pos0, row.pos1, row.pos2].map((x) => x == null ? null : String(x));
        let primary = null;
        let secondary = null;
        let tertiary = null;
        for (let i = 0; i < positions.length; i++) {
            const v = positions[i];
            if (!v)
                continue;
            if (!PROTECTED_TAGS.has(v) && primary == null) {
                primary = v;
                continue;
            }
            if (!v)
                continue;
            if (primary != null && secondary == null && !PROTECTED_TAGS.has(v)) {
                secondary = v;
                continue;
            }
            if (primary != null && secondary != null && tertiary == null && !PROTECTED_TAGS.has(v)) {
                tertiary = v;
            }
        }
        if (!primary) {
            uncategorizedNotes.push(note);
            return;
        }
        if (!hierarchy[primary])
            hierarchy[primary] = { notes: [], secondary: {} };
        if (!secondary) {
            hierarchy[primary].notes.push(note);
            return;
        }
        if (!hierarchy[primary].secondary[secondary])
            hierarchy[primary].secondary[secondary] = { notes: [], tertiary: {} };
        if (!tertiary) {
            hierarchy[primary].secondary[secondary].notes.push(note);
            return;
        }
        if (!hierarchy[primary].secondary[secondary].tertiary[tertiary])
            hierarchy[primary].secondary[secondary].tertiary[tertiary] = [];
        hierarchy[primary].secondary[secondary].tertiary[tertiary].push(note);
    });
    const ordered = {};
    const keys = Object.keys(hierarchy).filter(Boolean).sort((a, b) => a.localeCompare(b));
    for (const k of keys)
        ordered[k] = hierarchy[k];
    return { hierarchy: ordered, uncategorizedNotes };
}
function getNotesInTrash() {
    // Return notes that have tag 'deleted', sorted by lastEdited desc
    const stmt = db.prepare(`
    SELECT n.*
    FROM notes n
    JOIN note_tags nt ON n.id = nt.noteId
    JOIN tags t ON nt.tagId = t.id
    WHERE LOWER(t.name) = 'deleted'
    AND (n.isTemp IS NULL OR n.isTemp = 0)
    ORDER BY n.lastEdited DESC
  `);
    const rows = stmt.all();
    return rows;
}
/**
 * Reconcile the database notes table with the on-disk `.md` files.
 *
 * Behavior (safe defaults):
 * - For each `.md` file in the notes directory not referenced by any DB note,
 *   create a new DB note. The note title is derived from the first non-empty
 *   line (stripping leading `#`), or the filename if none.
 * - For each DB note that references a path that no longer exists on disk,
 *   add the protected `deleted` tag (position 0) if not already present.
 * - If a file exists named `<id>.md` and a DB note with that id exists but
 *   has a different `filePath`, update the DB `filePath` to the expected
 *   location.
 *
 * Returns details about actions taken so the caller can present results.
 */
function reconcileNotesWithFs(opts) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a, _b, _c, _d, _e, _f;
        const markMissingAsDeleted = (_a = opts === null || opts === void 0 ? void 0 : opts.markMissingAsDeleted) !== null && _a !== void 0 ? _a : true;
        const notesDir = (0, paths_1.getNotesDir)();
        const results = { createdNoteIds: [], updatedPaths: [], markedDeletedNoteIds: [] };
        let files = [];
        try {
            files = (yield fs.readdir(notesDir)).filter(f => f.toLowerCase().endsWith('.md'));
        }
        catch (err) {
            // If notes dir inaccessible, nothing to do.
            return results;
        }
        const absFiles = new Set(files.map(f => path.normalize(path.join(notesDir, f))));
        const allNotes = getAllNotes();
        const dbPathMap = new Map();
        const dbIdMap = new Map();
        for (const n of allNotes) {
            try {
                dbPathMap.set(path.normalize(n.filePath), n);
            }
            catch (_g) {
                dbPathMap.set(String(n.filePath), n);
            }
            dbIdMap.set(n.id, n);
        }
        // Build a quick lookup of notes whose files are currently missing on disk,
        // keyed by lowercased title to allow associating orphan files created externally
        // with their DB note when the content/title matches.
        const missingNotesByTitle = new Map();
        for (const n of allNotes) {
            try {
                const norm = path.normalize(n.filePath);
                if (!absFiles.has(norm)) {
                    const key = String((_b = n.title) !== null && _b !== void 0 ? _b : '').trim().toLowerCase();
                    const arr = (_c = missingNotesByTitle.get(key)) !== null && _c !== void 0 ? _c : [];
                    arr.push(n);
                    missingNotesByTitle.set(key, arr);
                }
            }
            catch (_h) {
                // ignore normalization errors
            }
        }
        // Ensure files referenced by DB use canonical filenames and tokens where possible.
        // This pass renames files (in-place) that are referenced by DB but don't follow
        // the YY-MM-DD_hh-mm_TOKEN.md pattern or where the DB lacks a token.
        for (const f of Array.from(absFiles)) {
            const note = dbPathMap.get(f);
            if (!note)
                continue;
            const base = path.basename(f, '.md');
            const match = /^([0-9]{2}-[0-9]{2}-[0-9]{2}_[0-9]{2}-[0-9]{2})_([A-Z0-9]{9})$/i.exec(base);
            try {
                const stat = yield fs.stat(f);
                const fileCreatedIso = (stat.birthtime && !isNaN(stat.birthtime.getTime())) ? stat.birthtime.toISOString() : stat.mtime.toISOString();
                const fileEditedIso = stat.mtime.toISOString();
                // Ensure DB has createdAt/lastEdited populated if missing
                if (!note.createdAt)
                    updateNoteCreatedAt(note.id, fileCreatedIso);
                if (!note.lastEdited)
                    updateNoteLastEdited(note.id, fileEditedIso);
                // If filename already matches and token matches DB, nothing to do
                if (match) {
                    const token = match[2].toUpperCase();
                    if (note.fileToken && String(note.fileToken).toUpperCase() === token)
                        continue;
                }
                // Need to ensure token exists
                let token = note.fileToken;
                if (!token) {
                    token = generateUniqueFileToken();
                    try {
                        setNoteFileToken(note.id, token);
                    }
                    catch (err) { /* non-fatal */ }
                }
                // Use DB createdAt if present (falls back to fileCreatedIso)
                const createdSource = (_d = note.createdAt) !== null && _d !== void 0 ? _d : fileCreatedIso;
                const d = new Date(createdSource);
                const yy = String(d.getFullYear()).slice(-2);
                const mm = String(d.getMonth() + 1).padStart(2, '0');
                const dd = String(d.getDate()).padStart(2, '0');
                const hh = String(d.getHours()).padStart(2, '0');
                const min = String(d.getMinutes()).padStart(2, '0');
                const fname = `${yy}-${mm}-${dd}_${hh}-${min}_${token}.md`;
                const dest = path.join(notesDir, fname);
                if (path.normalize(dest) !== path.normalize(f)) {
                    try {
                        yield fs.rename(f, dest);
                        updateNoteFilePath(note.id, dest);
                        // update maps so later logic skips this new path
                        dbPathMap.delete(f);
                        dbPathMap.set(path.normalize(dest), note);
                        absFiles.delete(f);
                        absFiles.add(path.normalize(dest));
                        results.updatedPaths.push({ noteId: note.id, oldPath: f, newPath: dest });
                    }
                    catch (err) {
                        // non-fatal - leave file in place
                        console.warn('[db] failed to rename file to canonical name', f, err);
                    }
                }
            }
            catch (err) {
                // ignore stat errors - will be handled later
            }
        }
        // 1) Files on disk not referenced by DB -> create notes or update existing by id
        for (const f of absFiles) {
            if (dbPathMap.has(f))
                continue; // already referenced
            const base = path.basename(f, '.md');
            // Read file content early so we can attempt title-based matching to existing missing notes
            let content = '';
            try {
                const { normalizeFileEncoding } = yield Promise.resolve().then(() => __importStar(__webpack_require__(/*! ./fileSystem */ "./src/main/fileSystem.ts")));
                content = yield normalizeFileEncoding(f);
            }
            catch (_j) {
                content = '';
            }
            const derivedTitle = (() => {
                const lines = content.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
                if (lines.length > 0) {
                    const first = lines[0].replace(/^#+\s*/, '').trim();
                    return first || base;
                }
                return base;
            })();
            // If there's a DB note whose file is missing and whose title matches this file's derived title,
            // associate the file to that note instead of creating a duplicate entry. This prevents newly
            // added files from causing their DB counterpart to be marked deleted.
            try {
                const key = String(derivedTitle).trim().toLowerCase();
                const bucket = missingNotesByTitle.get(key);
                if (bucket && bucket.length > 0) {
                    const note = bucket.shift(); // take first candidate
                    const old = note.filePath;
                    // derive timestamps from file stat
                    let createdIso = new Date().toISOString();
                    let editedIso = new Date().toISOString();
                    try {
                        const stat = yield fs.stat(f);
                        createdIso = (stat.birthtime && !isNaN(stat.birthtime.getTime())) ? stat.birthtime.toISOString() : stat.mtime.toISOString();
                        editedIso = stat.mtime.toISOString();
                    }
                    catch (_k) {
                        void 0;
                    }
                    // populate DB created/lastEdited if missing
                    try {
                        if (!note.createdAt)
                            updateNoteCreatedAt(note.id, createdIso);
                    }
                    catch (_l) {
                        void 0;
                    }
                    try {
                        if (!note.lastEdited)
                            updateNoteLastEdited(note.id, editedIso);
                    }
                    catch (_m) {
                        void 0;
                    }
                    // ensure token exists and rename to canonical filename
                    let token = note.fileToken;
                    if (!token) {
                        token = generateUniqueFileToken();
                        try {
                            setNoteFileToken(note.id, token);
                        }
                        catch (_o) {
                            void 0;
                        }
                    }
                    const createdSource = (_e = note.createdAt) !== null && _e !== void 0 ? _e : createdIso;
                    const d = new Date(createdSource);
                    const yy = String(d.getFullYear()).slice(-2);
                    const mm = String(d.getMonth() + 1).padStart(2, '0');
                    const dd = String(d.getDate()).padStart(2, '0');
                    const hh = String(d.getHours()).padStart(2, '0');
                    const min = String(d.getMinutes()).padStart(2, '0');
                    const fname = `${yy}-${mm}-${dd}_${hh}-${min}_${token}.md`;
                    const dest = path.join(notesDir, fname);
                    try {
                        yield fs.rename(f, dest);
                        updateNoteFilePath(note.id, dest);
                        // update maps so later logic skips this new path
                        dbPathMap.set(path.normalize(dest), note);
                        absFiles.delete(f);
                        absFiles.add(path.normalize(dest));
                        results.updatedPaths.push({ noteId: note.id, oldPath: old, newPath: dest });
                    }
                    catch (err) {
                        // fallback: point DB at the original path if rename failed
                        updateNoteFilePath(note.id, f);
                        dbPathMap.set(path.normalize(f), note);
                        results.updatedPaths.push({ noteId: note.id, oldPath: old, newPath: f });
                    }
                    try {
                        upsertNoteFts(note.id, (_f = note.title) !== null && _f !== void 0 ? _f : derivedTitle, content);
                    }
                    catch (_p) {
                        void 0;
                    }
                    continue;
                }
            }
            catch (err) {
                // non-fatal - continue to other heuristics
            }
            // Expect format: YY-MM-DD_hh-mm_TOKEN (TOKEN = 9 uppercase alnum)
            const m = /^([0-9]{2}-[0-9]{2}-[0-9]{2}_[0-9]{2}-[0-9]{2})_([A-Z0-9]{9})$/i.exec(base);
            if (m) {
                const datePart = m[1];
                const token = m[2].toUpperCase();
                const existing = getNoteByToken(token);
                if (existing) {
                    const old = existing.filePath;
                    if (path.normalize(old) !== f) {
                        updateNoteFilePath(existing.id, f);
                        results.updatedPaths.push({ noteId: existing.id, oldPath: old, newPath: f });
                    }
                    // Verify createdAt matches datePart (YY-MM-DD_hh-mm)
                    try {
                        const parts = /^([0-9]{2})-([0-9]{2})-([0-9]{2})_([0-9]{2})-([0-9]{2})$/.exec(datePart);
                        if (parts) {
                            const yy = Number(parts[1]);
                            const year = 2000 + yy;
                            const month = Number(parts[2]) - 1;
                            const day = Number(parts[3]);
                            const hour = Number(parts[4]);
                            const minute = Number(parts[5]);
                            const parsedIso = new Date(year, month, day, hour, minute).toISOString();
                            const noteCreated = new Date(existing.createdAt).toISOString();
                            const fmtNote = new Date(noteCreated);
                            if (Math.abs(new Date(parsedIso).getTime() - fmtNote.getTime()) > 60 * 1000) {
                                // If mismatch > 1 minute, update DB to match file timestamp
                                updateNoteCreatedAt(existing.id, parsedIso);
                            }
                        }
                    }
                    catch (err) { /* non-fatal */ }
                    continue;
                }
                // No existing token -> create a new note and record token + createdAt
                const title = (() => {
                    const lines = content.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
                    if (lines.length > 0) {
                        const first = lines[0].replace(/^#+\s*/, '').trim();
                        return first || base;
                    }
                    return base;
                })();
                const createdNote = createNote(title, f);
                try {
                    setNoteFileToken(createdNote.id, token);
                }
                catch (err) { /* non-fatal */ }
                try {
                    const parts = /^([0-9]{2})-([0-9]{2})-([0-9]{2})_([0-9]{2})-([0-9]{2})$/.exec(m[1]);
                    if (parts) {
                        const yy = Number(parts[1]);
                        const year = 2000 + yy;
                        const month = Number(parts[2]) - 1;
                        const day = Number(parts[3]);
                        const hour = Number(parts[4]);
                        const minute = Number(parts[5]);
                        const parsedIso = new Date(year, month, day, hour, minute).toISOString();
                        updateNoteCreatedAt(createdNote.id, parsedIso);
                    }
                }
                catch (err) { /* non-fatal */ }
                try {
                    upsertNoteFts(createdNote.id, title, content);
                }
                catch ( /* non-fatal */_q) { /* non-fatal */ }
                results.createdNoteIds.push(createdNote.id);
                continue;
            }
            // Fallback: previous behavior (numeric basename -> update by id, otherwise create)
            const parsedId = Number(base);
            if (!Number.isNaN(parsedId) && dbIdMap.has(parsedId)) {
                // Note exists by id but path differs -> update filePath
                const note = dbIdMap.get(parsedId);
                const old = note.filePath;
                if (path.normalize(old) !== f) {
                    updateNoteFilePath(parsedId, f);
                    results.updatedPaths.push({ noteId: parsedId, oldPath: old, newPath: f });
                }
                continue;
            }
            // Otherwise create a new note entry. Derive title from file contents,
            // generate token, rename file to canonical name, and populate created/lastEdited from stat.
            const title = (() => {
                const lines = content.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
                if (lines.length > 0) {
                    const first = lines[0].replace(/^#+\s*/, '').trim();
                    return first || base;
                }
                return base;
            })();
            // derive timestamps from file stat
            let createdIso = new Date().toISOString();
            let editedIso = new Date().toISOString();
            try {
                const stat = yield fs.stat(f);
                createdIso = (stat.birthtime && !isNaN(stat.birthtime.getTime())) ? stat.birthtime.toISOString() : stat.mtime.toISOString();
                editedIso = stat.mtime.toISOString();
            }
            catch (err) {
                // non-fatal
            }
            const token = generateUniqueFileToken();
            // build canonical filename
            try {
                const d = new Date(createdIso);
                const yy = String(d.getFullYear()).slice(-2);
                const mm = String(d.getMonth() + 1).padStart(2, '0');
                const dd = String(d.getDate()).padStart(2, '0');
                const hh = String(d.getHours()).padStart(2, '0');
                const min = String(d.getMinutes()).padStart(2, '0');
                const fname = `${yy}-${mm}-${dd}_${hh}-${min}_${token}.md`;
                const dest = path.join(notesDir, fname);
                try {
                    yield fs.rename(f, dest);
                }
                catch (err) {
                    // if rename fails, fall back to leaving file in place and still create DB entry pointing to original path
                }
                const createdNote = createNote(title, path.normalize(path.join(notesDir, fname)));
                try {
                    setNoteFileToken(createdNote.id, token);
                }
                catch (err) { /* non-fatal */ }
                try {
                    updateNoteCreatedAt(createdNote.id, createdIso);
                }
                catch (err) { /* non-fatal */ }
                try {
                    updateNoteLastEdited(createdNote.id, editedIso);
                }
                catch (err) { /* non-fatal */ }
                try {
                    upsertNoteFts(createdNote.id, title, content);
                }
                catch ( /* non-fatal */_r) { /* non-fatal */ }
                results.createdNoteIds.push(createdNote.id);
            }
            catch (err) {
                // final fallback: create note pointing to original file
                const createdNote = createNote(title, f);
                try {
                    upsertNoteFts(createdNote.id, title, content);
                }
                catch ( /* non-fatal */_s) { /* non-fatal */ }
                results.createdNoteIds.push(createdNote.id);
            }
        }
        // 2) DB notes referencing missing files -> mark as deleted (safe, non-destructive)
        if (markMissingAsDeleted) {
            for (const note of allNotes) {
                const fp = note.filePath;
                if (!fp)
                    continue;
                const norm = path.normalize(fp);
                if (absFiles.has(norm))
                    continue; // file present
                // only mark if not already tagged 'deleted'
                try {
                    const tags = getNoteTags(note.id);
                    const alreadyDeleted = tags.some(t => { var _a, _b; return String((_b = (_a = t.tag) === null || _a === void 0 ? void 0 : _a.name) !== null && _b !== void 0 ? _b : '').toLowerCase() === 'deleted'; });
                    if (!alreadyDeleted) {
                        addTagToNote(note.id, 'deleted', 0);
                        results.markedDeletedNoteIds.push(note.id);
                    }
                }
                catch (err) {
                    // non-fatal, continue
                }
            }
        }
        return results;
    });
}
function saveNoteSnapshot(noteId, content, isManual = false) {
    const latestSnapshot = db.prepare('SELECT id, content FROM note_snapshots WHERE noteId = ? ORDER BY timestamp DESC LIMIT 1').get(noteId);
    if (latestSnapshot && latestSnapshot.content === content && !isManual) {
        return;
    }
    const timestamp = new Date().toISOString();
    const insertStmt = db.prepare('INSERT INTO note_snapshots (noteId, content, timestamp, isManual) VALUES (?, ?, ?, ?)');
    const deleteStmt = db.prepare('DELETE FROM note_snapshots WHERE id = ?');
    const saveTx = db.transaction(() => {
        insertStmt.run(noteId, content, timestamp, isManual ? 1 : 0);
        if (latestSnapshot && latestSnapshot.content === content && isManual) {
            deleteStmt.run(latestSnapshot.id);
        }
        compactNoteSnapshots(noteId);
    });
    saveTx();
}
function getNoteSnapshots(noteId) {
    const rows = db.prepare('SELECT * FROM note_snapshots WHERE noteId = ? ORDER BY timestamp DESC').all(noteId);
    return rows.map(r => ({
        id: r.id,
        noteId: r.noteId,
        content: r.content,
        timestamp: r.timestamp,
        isManual: r.isManual === 1
    }));
}
function deleteNoteSnapshot(snapshotId) {
    db.prepare('DELETE FROM note_snapshots WHERE id = ?').run(snapshotId);
}
function compactNoteSnapshots(noteId) {
    const snapshots = db.prepare('SELECT * FROM note_snapshots WHERE noteId = ? ORDER BY timestamp DESC').all(noteId);
    if (snapshots.length === 0)
        return;
    const now = Date.now();
    const toDelete = [];
    const keptSnapshots = [];
    let lastKeptContent = null;
    let lastKeptAge = -1;
    const MAX_CHECK_AGE = 12 * 60 * 60 * 1000;
    for (const snap of snapshots) {
        const age = now - new Date(snap.timestamp).getTime();
        if (snap.isManual === 1) {
            keptSnapshots.push(snap);
            lastKeptContent = snap.content;
            lastKeptAge = age;
            continue;
        }
        if (lastKeptContent !== null && lastKeptContent === snap.content) {
            toDelete.push(snap.id);
            continue;
        }
        let kept = false;
        if (lastKeptAge === -1) {
            kept = true;
        }
        else {
            const timeDiff = age - lastKeptAge;
            const threshold = Math.min(age / 2, MAX_CHECK_AGE);
            if (timeDiff >= threshold) {
                kept = true;
            }
        }
        if (kept) {
            lastKeptContent = snap.content;
            lastKeptAge = age;
            keptSnapshots.push(snap);
        }
        else {
            toDelete.push(snap.id);
        }
    }
    if (toDelete.length > 0) {
        const deleteStmt = db.prepare('DELETE FROM note_snapshots WHERE id = ?');
        const transaction = db.transaction((ids) => {
            for (const id of ids)
                deleteStmt.run(id);
        });
        transaction(toDelete);
    }
}


/***/ },

/***/ "./src/main/fileSystem.ts"
/*!********************************!*\
  !*** ./src/main/fileSystem.ts ***!
  \********************************/
(__unused_webpack_module, exports, __webpack_require__) {

"use strict";

var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.normalizeFileEncoding = normalizeFileEncoding;
exports.initFileSystem = initFileSystem;
exports.saveNoteContent = saveNoteContent;
exports.copyFileToNotes = copyFileToNotes;
exports.loadNoteContent = loadNoteContent;
exports.deleteNoteFile = deleteNoteFile;
const fs = __importStar(__webpack_require__(/*! fs/promises */ "fs/promises"));
const path = __importStar(__webpack_require__(/*! path */ "path"));
const paths_1 = __webpack_require__(/*! ./paths */ "./src/main/paths.ts");
// Minimal CP1252 mapping for bytes 0x80-0x9F to Unicode.
const CP1252_MAP = {
    0x80: '\u20AC', 0x82: '\u201A', 0x83: '\u0192', 0x84: '\u201E', 0x85: '\u2026',
    0x86: '\u2020', 0x87: '\u2021', 0x88: '\u02C6', 0x89: '\u2030', 0x8A: '\u0160',
    0x8B: '\u2039', 0x8C: '\u0152', 0x8E: '\u017D', 0x91: '\u2018', 0x92: '\u2019',
    0x93: '\u201C', 0x94: '\u201D', 0x95: '\u2022', 0x96: '\u2013', 0x97: '\u2014',
    0x98: '\u02DC', 0x99: '\u2122', 0x9A: '\u0161', 0x9B: '\u203A', 0x9C: '\u0153',
    0x9E: '\u017E', 0x9F: '\u0178'
};
function decodeCp1252(buf) {
    let out = '';
    for (let i = 0; i < buf.length; i++) {
        const b = buf[i];
        if (b >= 0x00 && b <= 0x7F) {
            out += String.fromCharCode(b);
        }
        else if (b >= 0xA0 && b <= 0xFF) {
            out += String.fromCharCode(b);
        }
        else if (CP1252_MAP[b]) {
            out += CP1252_MAP[b];
        }
        else {
            out += String.fromCharCode(b);
        }
    }
    return out;
}
/**
 * Read `filePath`, detect likely UTF-8 decoding issues (replacement char),
 * and if found attempt to decode as CP1252 and rewrite the file as UTF-8.
 * Returns the normalized UTF-8 string content.
 */
function normalizeFileEncoding(filePath) {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            const buf = yield fs.readFile(filePath);
            // Check for UTF-16LE BOM
            if (buf.length >= 2 && buf[0] === 0xFF && buf[1] === 0xFE) {
                return buf.toString('utf16le');
            }
            // Check for UTF-16BE BOM (less common, but handled via byte swapping)
            if (buf.length >= 2 && buf[0] === 0xFE && buf[1] === 0xFF) {
                return buf.swap16().toString('utf16le');
            }
            // Check for UTF-8 BOM
            if (buf.length >= 3 && buf[0] === 0xEF && buf[1] === 0xBB && buf[2] === 0xBF) {
                return buf.slice(3).toString('utf8');
            }
            // Try UTF-8 first
            const asUtf8 = buf.toString('utf8');
            if (!asUtf8.includes('\uFFFD'))
                return asUtf8;
            // Fallback: decode as CP1252 and write back as UTF-8
            const decoded = decodeCp1252(buf);
            try {
                yield fs.writeFile(filePath, decoded, 'utf8');
            }
            catch (err) {
                // ignore write errors
            }
            return decoded;
        }
        catch (err) {
            return '';
        }
    });
}
function initFileSystem() {
    return __awaiter(this, void 0, void 0, function* () {
        const notesDir = (0, paths_1.getNotesDir)();
        try {
            yield fs.access(notesDir);
        }
        catch (_a) {
            yield fs.mkdir(notesDir, { recursive: true });
        }
    });
}
function saveNoteContent(noteId, content, destFileName) {
    return __awaiter(this, void 0, void 0, function* () {
        const notesDir = (0, paths_1.getNotesDir)();
        const filePath = destFileName ? path.join(notesDir, destFileName) : path.join(notesDir, `${noteId}.md`);
        yield fs.writeFile(filePath, content, 'utf-8');
        return filePath;
    });
}
function copyFileToNotes(srcPath, destFileName) {
    return __awaiter(this, void 0, void 0, function* () {
        const notesDir = (0, paths_1.getNotesDir)();
        const dest = path.join(notesDir, destFileName);
        yield fs.copyFile(srcPath, dest);
        return dest;
    });
}
function loadNoteContent(filePath) {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            return yield normalizeFileEncoding(filePath);
        }
        catch (_a) {
            return '';
        }
    });
}
function deleteNoteFile(filePath) {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            yield fs.unlink(filePath);
        }
        catch (error) {
            console.error('Error deleting note file:', error);
        }
    });
}


/***/ },

/***/ "./src/main/paths.ts"
/*!***************************!*\
  !*** ./src/main/paths.ts ***!
  \***************************/
(__unused_webpack_module, exports, __webpack_require__) {

"use strict";

var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.getDataDir = getDataDir;
exports.getDbPath = getDbPath;
exports.getNotesDir = getNotesDir;
const path = __importStar(__webpack_require__(/*! path */ "path"));
const electron_1 = __webpack_require__(/*! electron */ "electron");
function getDataDir() {
    if (electron_1.app.isPackaged) {
        // Production: data folder next to the executable
        return path.join(path.dirname(electron_1.app.getPath('exe')), 'data');
    }
    else {
        // Development: data folder in project root
        return path.join(process.cwd(), 'data');
    }
}
function getDbPath() {
    return path.join(getDataDir(), 'notes.db');
}
function getNotesDir() {
    return path.join(getDataDir(), 'notes');
}


/***/ },

/***/ "child_process"
/*!********************************!*\
  !*** external "child_process" ***!
  \********************************/
(module) {

"use strict";
module.exports = require("child_process");

/***/ },

/***/ "electron"
/*!***************************!*\
  !*** external "electron" ***!
  \***************************/
(module) {

"use strict";
module.exports = require("electron");

/***/ },

/***/ "fs"
/*!*********************!*\
  !*** external "fs" ***!
  \*********************/
(module) {

"use strict";
module.exports = require("fs");

/***/ },

/***/ "fs/promises"
/*!******************************!*\
  !*** external "fs/promises" ***!
  \******************************/
(module) {

"use strict";
module.exports = require("fs/promises");

/***/ },

/***/ "net"
/*!**********************!*\
  !*** external "net" ***!
  \**********************/
(module) {

"use strict";
module.exports = require("net");

/***/ },

/***/ "path"
/*!***********************!*\
  !*** external "path" ***!
  \***********************/
(module) {

"use strict";
module.exports = require("path");

/***/ },

/***/ "tty"
/*!**********************!*\
  !*** external "tty" ***!
  \**********************/
(module) {

"use strict";
module.exports = require("tty");

/***/ },

/***/ "util"
/*!***********************!*\
  !*** external "util" ***!
  \***********************/
(module) {

"use strict";
module.exports = require("util");

/***/ }

/******/ 	});
/************************************************************************/
/******/ 	// The module cache
/******/ 	var __webpack_module_cache__ = {};
/******/ 	
/******/ 	// The require function
/******/ 	function __webpack_require__(moduleId) {
/******/ 		// Check if module is in cache
/******/ 		var cachedModule = __webpack_module_cache__[moduleId];
/******/ 		if (cachedModule !== undefined) {
/******/ 			return cachedModule.exports;
/******/ 		}
/******/ 		// Check if module exists (development only)
/******/ 		if (__webpack_modules__[moduleId] === undefined) {
/******/ 			var e = new Error("Cannot find module '" + moduleId + "'");
/******/ 			e.code = 'MODULE_NOT_FOUND';
/******/ 			throw e;
/******/ 		}
/******/ 		// Create a new module (and put it into the cache)
/******/ 		var module = __webpack_module_cache__[moduleId] = {
/******/ 			// no module.id needed
/******/ 			// no module.loaded needed
/******/ 			exports: {}
/******/ 		};
/******/ 	
/******/ 		// Execute the module function
/******/ 		__webpack_modules__[moduleId].call(module.exports, module, module.exports, __webpack_require__);
/******/ 	
/******/ 		// Return the exports of the module
/******/ 		return module.exports;
/******/ 	}
/******/ 	
/************************************************************************/
/******/ 	/* webpack/runtime/compat */
/******/ 	
/******/ 	if (typeof __webpack_require__ !== 'undefined') __webpack_require__.ab = __dirname + "/native_modules/";
/******/ 	
/************************************************************************/
/******/ 	
/******/ 	// startup
/******/ 	// Load entry module and return exports
/******/ 	// This entry module is referenced by other modules so it can't be inlined
/******/ 	var __webpack_exports__ = __webpack_require__("./src/index.ts");
/******/ 	module.exports = __webpack_exports__;
/******/ 	
/******/ })()
;
//# sourceMappingURL=index.js.map