const Vue = require('vue/dist/vue');



class ProjectPanel {

    constructor(el) {
        require('./components/file-list');
        require('./components/problem-list');

        el = el || this._createDOM();

        this.view = new Vue({
            el: el,
            data: {
                files: [],
                root: []
            }
        });

        this.view.$on('action', ev => this.onAction(ev));
        this.view.$watch('files', v => this._update(v));

        this.editor_provider = undefined;
    }

    get $el() { return this.view.$el; }

    open(project) {
        this.project = project;
        this.view.files = project.vfiles.map(filename => ({filename}));

        if (this.editor_provider) this._associateStore();
    }

    withEditor(editor_provider) {
        this.editor_provider = editor_provider;
        if (this.project) this._associateStore();
        return this;
    }

    build() {
        const {CoqBuild} = require('./coq-build');  // cyclic :(
        var build = new CoqBuild().ofProject(this.project, true).withUI(this);
        build.start();
        return build;
    }

    _createDOM() {
        return $('<div>').attr('id', 'project-panel').html(`
            <file-list ref="file_list" :files="root"
                       @action="$emit('action', $event)"/>
        `)[0]; 
    }

    _update(files) {
        for (let {filename, status} of files) {
            var e = this.view.$refs.file_list.create(filename);
            e.tags = status ? [ProjectPanel.BULLETS[status]] : [];
        }
    }

    _associateStore() {
        // Only one editor store can exist at any given time :/
        const store = this.project.store;
        CmCoqProvider.file_store = {
            async getItem(filename) { return store.readFileSync(filename, 'utf-8'); },
            async setItem(filename, content) { store.file_map.set(filename, content); }
        };        
    }

    onAction(ev) {
        if (this.editor_provider 
              && ev.type === 'select' && ev.kind === 'file') {
            this.editor_provider.openLocal(`/${ev.path.join('/')}`);
            // @todo update marks (from build)
        }
    }

    /**
     * This is here temporarily for quick testing.
     */
    static sample() {
        var {FileStore, CoqProject} = coqBuild;

        // sample project
        var fs = new FileStore();
        fs.file_map.set('/simple/_CoqProject', '-R . simple\n\nOne.v Two.v Three.v\n');
        fs.file_map.set('/simple/One.v', 'Check 1.\nFrom simple Require Import Two.');
        fs.file_map.set('/simple/Two.v', 'Definition two_of a := a + a.\n');
        fs.file_map.set('/simple/Three.v', 'From simple Require Import One Two.');
    
        var proj = CoqProject.fromDirectory('/simple', null, fs.fsif);
        proj.store = fs;
        return proj;
    }    

}


ProjectPanel.BULLETS = {
    compiling: {text: '◎', class: 'compiling'},
    compiled: {text: '✓', class: 'compiled'},
    error: {text: '✗', class: 'error'}
};



module.exports = { ProjectPanel };
