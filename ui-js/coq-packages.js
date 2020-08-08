"use strict";

class PackageManager {

    /**
     * Creates the packages UI and loading manager.
     *
     * @param {Element} panel_dom <div> element to hold the package entries
     * @param {object} packages an object containing package URLs and lists of 
     *   names in the format
     *   `{'base_uri1', ['pkg_name1', 'pkg_name2', ...], 'base_uri2': ...}`.
     * @param {object} pkg_path_aliases mnemonic for specific base URIs
     * @param {CoqWorker} coq reference to the Coq worker instance to send
     *   load requests to
     */
    constructor(panel_dom, packages, pkg_path_aliases, coq) {
        this.panel         = panel_dom;
        this.bundles       = {};
        this.loaded_pkgs   = [];
        this.coq           = coq;

        this.initializePackageList(packages, pkg_path_aliases);
    }

    /**
     * Creates CoqPkgInfo objects according to the paths in names in the given
     * `packages` object.
     * @param {object} packages (see constructor)
     * @param {object} aliases (ditto)
     */
    initializePackageList(packages, aliases={}) {
        this.packages = [];
        this.packages_by_name = {};
        this.packages_by_uri = {};

        // normalize all URI paths to end with a slash
        let mkpath = path => path && path.replace(/([^/])$/, '$1/');

        for (let [key, pkg_names] of Object.entries(packages)) {
            let base_uri = mkpath(aliases[key] || key);

            for (let pkg of pkg_names) {
                var uri = mkpath(aliases[`${key}/${pkg}`]) || base_uri;
                this.addPackage(new CoqPkgInfo(pkg, uri));
            }
        }
    }

    static defaultPkgPath() {
        return new URL('../coq-pkgs/', CoqWorker.scriptUrl).href;
    }

    populate() {
        for (let [base_uri, pkgs] of Object.entries(this.packages_by_uri)) {
            this.coq.infoPkg(base_uri, pkgs);
        }
    }

    addPackage(pkg) {
        this.packages.push(pkg);
        this.packages_by_name[pkg.name] = pkg;
        (this.packages_by_uri[pkg.base_uri] = 
            this.packages_by_uri[pkg.base_uri] || []).push(pkg.name);
    }

    getPackage(pkg_name) {
        var pkg = this.packages_by_name[pkg_name];
        if (!pkg) throw new Error(`internal error: unrecognized package '${pkg_name}'`);
        return pkg;
    }

    hasPackageInfo(pkg_name) {
        var pkg = this.packages_by_name[pkg_name];
        return pkg && pkg.info;
    }

    addRow(bname, desc = bname, parent) {
        var row = $('<div>').addClass('package-row').attr('data-name', bname)
            .append($('<button>').addClass('download-icon')
                    .click(() => { this.startPackageDownload(bname); }))
            .append($('<span>').addClass('desc').text(desc)
                    .click(() => { this._expandCollapseRow(row); }));

        if (parent) {
            parent.row.append(row);
        }
        else {
            // Find bundle's proper place in the order among existing entries
            var pkg_names = this.packages.map(p => p.name),
                place_before = null, idx = pkg_names.indexOf(bname);

            if (idx > -1) {
                for (let e of $(this.panel).children()) {
                    let eidx = pkg_names.indexOf($(e).attr('data-name'));
                    if (eidx == -1 || eidx > idx) {
                        place_before = e;
                        break;
                    }
                }
            }

            this.panel.insertBefore(row[0], place_before /* null == at end */ );
        }

        return this.bundles[bname] = { row };
    }

    addBundleInfo(bname, pkg_info, parent) {

        var bundle = this.addRow(bname, pkg_info.desc, parent);

        var pkg = this.getPackage(bname);
        pkg.setInfo(pkg_info);

        if (pkg.archive) {
            pkg.archive.onProgress = evt => this.showPackageProgress(bname, evt);
        }

        if (pkg_info.chunks) {
            pkg.chunks = [];

            for (let chunk of pkg_info.chunks) {
                var subpkg = new CoqPkgInfo(chunk.desc, pkg.base_uri);
                this.addPackage(subpkg);
                this.addBundleInfo(subpkg.name, chunk, bundle);
                pkg.chunks.push(subpkg);
                subpkg.parent = pkg;
            }
        }

        this.dispatchEvent(new Event('change'));
    }

    async addBundleZip(bname, resource, pkg_info) {
        pkg_info = pkg_info || {};

        var archive = await new CoqPkgArchive(resource).load();

        return archive.getPackageInfo().then(pi => {
            bname = bname || pi.desc;

            if (!bname) throw new Error('invalid archive: missing package manifest (coq-pkg.json)');
            if (this.packages_by_name[bname]) throw new Error(`package ${bname} is already present`);

            for (let k in pi)
                if (!pkg_info[k]) pkg_info[k] = pi[k];

            var pkg = new CoqPkgInfo(bname, '');
            this.packages.push(pkg);
            this.packages_by_name[bname] = pkg;

            this.addBundleInfo(bname, pkg_info);
            pkg.archive = archive;
            return pkg;
        });
    }

    waitFor(init_pkgs) {
        let all_set = () => init_pkgs.every(x => this.hasPackageInfo(x));

        return new Promise((resolve, reject) => {
            var observe = () => {
                if (all_set()) {
                    this.removeEventListener('change', observe);
                    resolve();
                    return true;
                }
            };
            if (!observe())
                this.addEventListener('change', observe);
        });
    }

    searchBundleInfo(prefix, module_name, exact=false) {
        // Look for a .vo file matching the given prefix and module name
        var implicit = (prefix.length === 0),
            suffix = module_name.slice(0, -1),
            basename = module_name.slice(-1)[0],
            possible_filenames = ['.vo', '.vio'].map(x => basename + x);

        let startsWith = (arr, prefix) => arr.slice(0, prefix.length).equals(prefix);
        let endsWith = (arr, suffix) => suffix.length == 0 || arr.slice(-suffix.length).equals(suffix);

        let isIntrinsic = (arr) => arr[0] === 'Coq';

        let pkg_matches = exact ? pkg_id => pkg_id.equals(suffix)
                                : pkg_id => (implicit ? isIntrinsic(pkg_id)
                                                      : startsWith(pkg_id, prefix)) &&
                                            endsWith(pkg_id, suffix);

        for (let pkg of this.packages) {
            if (!pkg.info) continue;
            for (let prefix of pkg.info.pkgs) {
                if (pkg_matches(prefix.pkg_id) &&
                    prefix.vo_files.some(entry => possible_filenames.indexOf(entry[0]) > -1))
                    return { pkg: pkg.name,
                             info: pkg.info, 
                             module: prefix.pkg_id.concat([basename]) };
            }
        }
    }

    searchModule(prefix, module_name, exact=false) {
        var binfo = this.searchBundleInfo(prefix, module_name, exact),
            lookupDeps = (binfo, key) =>
                (binfo && binfo.info.modDeps && binfo.info.modDeps.hasOwnProperty(key))
                    ? binfo.info.modDeps[key] : [];
        if (binfo) {
            var pkgs = new Set([binfo.pkg]),
                module_deps = lookupDeps(binfo, binfo.module.join('.'));
            this._scan(module_deps,
                m => {
                    var binfo = this.searchBundleInfo([], m.split('.'), true);
                    if (binfo) pkgs.add(binfo.pkg);
                    return lookupDeps(binfo, m);
                });
            binfo.deps = [...pkgs.values()];
        }
        return binfo;
    }

    getUrl(pkg_name, resource) {
        return this.packages_by_name[pkg_name].getUrl(resource);
    }

    getLoadPath() {
        return this.loaded_pkgs.map( pkg_name => {
            let pkg = this.getPackage(pkg_name),
                phys = pkg.archive ? ['/lib'] : [];
            return pkg.info.pkgs.map( pkg => [pkg.pkg_id, phys] );
        }).flatten();
    }

    /**
     * Loads a package from the preconfigured path.
     * @param {string} pkg_name name of package (e.g., 'init', 'mathcomp')
     */
    startPackageDownload(pkg_name) {
        var pkg = this.getPackage(pkg_name), promise;

        if (pkg.promise) return pkg.promise;  /* load issued already */

        if (pkg.info.chunks) {
            promise = this.loadDeps(pkg.info.chunks.map(x => x.desc));
        }
        else if (pkg.archive) {
            promise = 
                Promise.all([this.loadDeps(pkg.info.deps),
                             pkg.archive.unpack(this.coq)])
                .then(() => this.onBundleLoad(pkg_name));
        }
        else {
            promise = 
                Promise.all([this.loadDeps(pkg.info.deps),
                             this.loadPkg(pkg_name)]);
        }

        this.showPackage(pkg_name);

        pkg.promise = promise;
        return promise;
    }

    showPackage(bname) {
        var bundle = this.bundles[bname];
        if (bundle && bundle.row) {
            bundle.row.parents('div.package-row').addClass('expanded');
            this._scrollTo(bundle.row[0]);
        }
    }

    _scrollTo(el) {
        if (el.scrollIntoViewIfNeeded) el.scrollIntoViewIfNeeded();
        else el.scrollIntoView();
    }

    /**
     * Updates the download progress bar on the UI.
     * @param {string} bname package bundle name
     * @param {object} info {loaded: <number>, total: <number>}
     */
    showPackageProgress(bname, info) {
        var bundle = this.bundles[bname];

        if (!bundle.bar) {
            // Add the progress bar if it does not exist already
            bundle.bar = $('<div>').addClass('progressbar');
            bundle.egg = $('<div>').addClass('progress-egg');

            bundle.bar.append(bundle.egg);
            bundle.row.append($('<div>').addClass('rel-pos').append(bundle.bar));
        }

        if (info) {
            var progress = info.loaded / info.total,
                angle    = (progress * 1500) % 360;
            bundle.egg.css('transform', `rotate(${angle}deg)`);
            bundle.bar.css('width', `${Math.min(1.0, progress) * 100}%`);
        }
    }

    /**
     * Marks the package download as complete, removing the progress bar.
     * @param {string} bname package bundle name
     */
    showPackageCompleted(bname) {
        var bundle = this.bundles[bname];

        bundle.row.children('.rel-pos').remove();
        bundle.row.children('button.download-icon').addClass('checked');

        var pkg = this.getPackage(bname);
        pkg.status = 'loaded';
        if (pkg.parent) this.showLoadedChunks(pkg.parent);
    }

    showLoadedChunks(pkg) {
        var bundle = this.bundles[pkg.name];
        bundle.row.addClass('has-chunks');

        var span = bundle.row.find('.loaded-chunks');
        if (span.length === 0)
            span = $('<span>').addClass('loaded-chunks')
                              .insertAfter(bundle.row.children('.desc'));

        var prefix = pkg.name + '-',
            shorten = name => name.startsWith(prefix) ? 
                              name.substr(prefix.length) : name;

        span.empty();
        for (let chunk of pkg.chunks) {
            if (chunk.status === 'loaded')
                span.append($('<span>').text(shorten(chunk.name)));
        }
        if (pkg.chunks.every(chunk => chunk.status === 'loaded'))
            this.showPackageCompleted(pkg.name);
    }

    /**
     * Adds a package from a dropped file and immediately downloads it.
     * @param {Blob} file a dropped File or a Blob that contains an archive
     */
    dropPackage(file) {
        this.expand();
        this.addBundleZip(undefined, file).then(pkg => {
            this.bundles[pkg.name].row[0].scrollIntoViewIfNeeded();
            this.startPackageDownload(pkg.name);
        })
        .catch(err => { alert(`${file.name}: ${err}`); });
    }

    onBundleStart(bname) {
        this.showPackageProgress(bname);
    }

    onPkgProgress(evt) {
        var info = this.getPackage(evt.bundle).info;
        ++info.loaded; // this is not actually the number of files loaded :\

        this.showPackageProgress(evt.bundle, info);
    }

    onBundleLoad(bname) {
        this.loaded_pkgs.push(bname);

        var pkg = this.getPackage(bname);
        if (pkg._resolve) pkg._resolve();

        this.showPackageCompleted(bname);
    }

    async loadDeps(deps) {
        await this.waitFor(deps);
        return Promise.all(
            deps.map(pkg => this.startPackageDownload(pkg)));
    }

    loadPkg(pkg_name) {
        var pkg = this.getPackage(pkg_name);

        return new Promise((resolve, reject) => {
            pkg._resolve = resolve 
            this.coq.loadPkg(pkg.base_uri, pkg_name);
        });
    }

    /**
     * Make all loaded packages unloaded.
     * This is called after the worker is restarted.
     * Does not drop downloaded/cached archives.
     */
    reset() {
        for (let pkg of this.packages) {
            delete pkg.promise;
        }
    }

    collapse() {
        this.panel.parentNode.classList.add('collapsed');
    }

    expand() {
        this.panel.parentNode.classList.remove('collapsed');
    }

    _expandCollapseRow(row) {
        row.toggleClass('expanded');
        if (row.hasClass('expanded')) {
            // account for CSS transition
            var anim = setInterval(() => row[0].scrollIntoViewIfNeeded(), 40);
            setTimeout(() => clearInterval(anim), 600);
        }
    }

    /**
     * (auxiliary method) traverses a graph spanned by a list of roots
     * and an adjacency functor. Implements DFS.
     * @param {array} roots starting points
     * @param {function} adjacent_out u => array of successors
     */
    _scan(roots, adjacent_out) {
        var collect = new Set(),
            work = roots.slice();
        while (work.length) {
            var u = work.pop();
            if (!collect.has(u)) {
                collect.add(u);
                for (let v of adjacent_out(u)) work.push(v);
            }
        }
        return collect;
    }

    // No portable way to create EventTarget instances of our own yet;
    // hijack the panel DOM element :\
    dispatchEvent(evt)             { this.panel.dispatchEvent(evt); }
    addEventListener(type, cb)     { this.panel.addEventListener(type, cb); }
    removeEventListener(type, cb)  { this.panel.removeEventListener(type, cb); }
}


class CoqPkgInfo {
    constructor(name, base_uri) {
        this.name = name;
        this.base_uri = base_uri;

        this.info = undefined;
        this.archive = undefined;
        this.chunks = undefined;
        this.parent = undefined;
    }

    getUrl(resource) {
        // Generate URL with the package's base_uri as the base
        return this.base_uri + resource;//new URL(resource, new URL(this.base_uri));
    }

    setInfo(info) {
        this.info = info;

        // Compute total number of files
        info.loaded = 0;
        info.total  = info.pkgs.map(pkg => pkg.vo_files.length)  // pkg.cma_files.length XXX
                               .reduce((x, y) => x + y, 0);

        // Get archive if specified
        if (info.archive)
            this.archive = new CoqPkgArchive(this.getUrl(info.archive));
    }
}


/**
 * Represents a bundle stored in a Zip archive; either a remote
 * file that has to be downloaded or a local one.
 */
class CoqPkgArchive {

    constructor(resource) {
        if (resource instanceof URL || typeof resource === 'string')
            this.url = resource;
        else if (resource instanceof Blob)
            this.blob = resource;
        else if (resource.file /* JSZip-like */)
            this.zip = resource;
        else
            throw new Error(`invalid resource for archive: '${resource}'`);

        this.onProgress = () => {};
    }

    load() {
        return this.zip ? Promise.resolve(this) :
            this.download().then(data =>
                JSZip.loadAsync(data)).then(zip =>
                    { this.zip = zip; return this; });
    }

    download() {
        if (this.blob) {
            return this.blob.arrayBuffer();
        }
        else {
            // Here comes some boilerplate
            return new Promise((resolve, reject) => {
                var xhr = new XMLHttpRequest();
                xhr.responseType = 'arraybuffer';
                xhr.onload = () => resolve(xhr.response);
                xhr.onprogress = (evt) => requestAnimationFrame(() => this.onProgress(evt));
                xhr.onerror = () => reject(new Error("download failed"));
                xhr.open('GET', this.url);
                xhr.send();
            });
        }
    }

    readManifest() {
        var manifest = this.zip.file('coq-pkg.json');
        return manifest ?
                manifest.async('text').then(data => JSON.parse(data))
                .catch(err => {
                    console.warn(`malformed 'coq-pkg.json' in bundle ${this.url || ''} (${err})`);
                    return {}; 
                })
              : Promise.resolve({});
    }

    getPackageInfo() {
        return this.readManifest().then(pkg_info => {

            var entries_by_dir = {};

            this.zip.forEach((rel_path, entry) => {
                var mo = /^(?:(.*)[/])(.*[.](?:vo|vio|cm[ao]))$/.exec(rel_path);
                if (mo) {
                    var [, dir, fn] = mo;
                    (entries_by_dir[dir] = entries_by_dir[dir] || []).push(fn);
                }
            });

            var pkgs = [];
            for (let dir in entries_by_dir) {
                pkgs.push({
                    pkg_id: dir.split('/'),
                    vo_files: entries_by_dir[dir].map(x => [x])
                });
            }

            pkg_info.pkgs = pkgs;
            return pkg_info;
        });
    }

    async unpack(worker) {
        await this.load();

        var asyncs = [];
        this.zip.forEach((rel_path, entry) => {
            if (!entry.dir)
                asyncs.push((async () => {
                    var content = await entry.async('arraybuffer');
                    await worker.put(`/lib/${rel_path}`, content, 
                            /*transferOwnership=*/true);
                })());
        });
        await Promise.all(asyncs);
    }

}


if (typeof document !== 'undefined' && document.currentScript)
    PackageManager.scriptUrl = new URL(document.currentScript.attributes.src.value, window.location);

if (typeof module !== 'undefined')
    module.exports = {CoqPkgArchive}

// Local Variables:
// js-indent-level: 4
// End:
