.PHONY: all clean upload all libs coq-tools
.PHONY: bytecode_bin javascript_bin
.PHONY: dist dist-upload dist-release dist-hott force
.PHONY: coq coq-get coq-build
.PHONY: addons addons-get addons-build addon-%-get addon-%-build

include config.mk

all:
	@echo "Welcome to jsCoq makefile. Targets are:"
	@echo ""
	@echo "  - bytecode_bin:   build jscoq's bytecode"
	@echo "  - javascript_bin: build jscoq's javascript"
	@echo "  - coq-get:        download Coq and libraries"
	@echo "  - coq-build:      build Coq and libraries"
	@echo "  - coq:            download and build Coq and libraries"
	@echo "  - coq-tools:      to be removed by the Dune-based build"

bytecode_bin:
	$(MAKE) -C coq-js bytecode_bin

javascript_bin:
	$(MAKE) -C coq-js javascript_bin

coq-tools:
	$(MAKE) -C coq-tools

########################################################################
# CMA building                                                         #
########################################################################

%.cma.js: %.cma
	js_of_ocaml $(JSOO_OPTS) --wrap-with-fun= -o $<.js $<

%.cmo.js: %.cmo
	js_of_ocaml $(JSOO_OPTS) --wrap-with-fun= -o $<.js $<

plugin-comp: $(addsuffix .js,$(shell find coq-pkgs \( -name *.cma -or -name *.cmo \)))

########################################################################
# Library building                                                     #
########################################################################

coq-pkgs:
	mkdir -p coq-pkgs

# It depends on coq-tools, but coq-tools is linked with the 32bit thing...
Makefile.libs: coq-tools/mklibfs
	./coq-tools/mklibfs > Makefile.libs

# Build Coq libraries
coq-libs: Makefile.libs coq-pkgs
	COQDIR=$(COQDIR) make -f Makefile.libs libs-auto

# Build extra libraries
coq-addons: coq-pkgs
	COQDIR=$(COQDIR) make -f Makefile.addons $(ADDONS)

coq-all-libs: coq-libs coq-addons

# All the libraries + json generation
libs: coq-all-libs
	./coq-tools/mklibjson # $(ADDONS)

# Bundle libs and inject dependencies
libs-pkg:
	node coq-tools/mkpkg.js coq-pkgs/*.json
	node coq-tools/mkdeps.js coq-pkgs/init.json coq-pkgs/coq-*.json $(COQDIR)/.vfiles.d

########################################################################
# Dists                                                                #
########################################################################

BUILDDIR=dist

DISTHTML=newide.html #mtac_tutorial.html
BUILDOBJ=package.json index.html $(DISTHTML) coq-pkgs ui-js ui-css ui-images examples
DISTEXT=$(addprefix ui-external/,CodeMirror-TeX-input)

dist:
	ln -sf $(DISTHTML) index.html
	mkdir -p $(BUILDDIR)
	# Copy static files, XXX: minimize
	rsync -avp --delete --exclude='*~' --exclude='.git' --exclude='.jshintrc' --exclude='*.cmo' \
	      --delete-excluded $(BUILDOBJ) $(BUILDDIR)
	# The monster
	mkdir -p $(BUILDDIR)/coq-js/
	cp -a coq-js/jscoq.js coq-js/jscoq_worker.js $(BUILDDIR)/coq-js/
	# Externals
	rsync -avp --delete --exclude='*~' --exclude='.git' --exclude='node_modules' \
	       --delete-excluded $(DISTEXT) $(BUILDDIR)/ui-external
	# Node stuff
	cd $(BUILDDIR) && npm install

BUILDDIR_HOTT=$(BUILDDIR)-hott

HOTT_FILES=hott-init.json hott.json HoTT
HOTT_SRC_FILES=$(addprefix $(BUILDDIR)/coq-pkgs/,$(HOTT_FILES))

dist-hott:
	rsync -av $(BUILDDIR)/ $(BUILDDIR_HOTT)
	rm -rf $(BUILDDIR_HOTT)/coq-pkgs/*
	rsync -av $(HOTT_SRC_FILES) $(BUILDDIR_HOTT)/coq-pkgs/
	rsync -av $(HOTT_COQLIB) $(BUILDDIR_HOTT)/coq-pkgs/Coq
	rsync -av $(BUILDDIR)/coq-pkgs/Coq/syntax $(BUILDDIR_HOTT)/coq-pkgs/Coq/
	cp -a newhott.html $(BUILDDIR_HOTT)/newide.html

########################################################################
# coqDoc Object
########################################################################


########################################################################
# Clean                                                                #
########################################################################

clean:
	$(MAKE) -C coq-js       clean
	$(MAKE) -C coq-tools    clean
	rm -f *.cmi *.cmo *.ml.d *.mli.d Makefile.libs index.html
	rm -rf coq-pkgs
	rm -rf $(BUILDDIR) $(BUILDDIR_HOTT)

########################################################################
# Local stuff and distributions
########################################################################

hott-upload: dist-hott
	rsync -avzp --delete dist-hott/ $(HOTT_RELEASE)

dist-upload: dist
	rsync -avzp --delete dist/ $(WEB_DIR)

dist-release: dist
	rsync -avzp --delete --exclude=README.md --exclude=get-hashes.sh --exclude=.git dist/ $(RELEASE_DIR)

# all-dist: dist dist-hott dist-release dist-upload hott-upload
all-dist: dist dist-release dist-upload

pau:
	rsync -avpz ~/research/jscoq pau:~/
	rsync -avpz pau:~/jscoq/ ~/research/pau-jscoq/

COQ_BRANCH=v8.9
COQ_REPOS=https://github.com/coq/coq.git
NJOBS=4

COQ_TARGETS = theories plugins bin/coqc bin/coqtop bin/coqdep bin/coq_makefile
COQ_MAKE_FLAGS = -j $(NJOBS)

ifeq (${shell uname -s}, Darwin)
# Coq cannot be built natively on macOS with 32-bit.
# At least not unless plugins are linked statically.
COQ_MAKE_FLAGS += BEST=byte
endif

coq-get:
	mkdir -p coq-external coq-pkgs
	git clone --depth=1 -b $(COQ_BRANCH) $(COQ_REPOS) $(COQDIR) || true
	cd $(COQDIR) && ./configure -local -native-compiler no -bytecode-compiler no -coqide no

coq-build:
	cd $(COQDIR) && $(MAKE) $(COQ_TARGETS) $(COQ_MAKE_FLAGS) && $(MAKE) byte $(COQ_MAKE_FLAGS)

coq: coq-get coq-build
	

addon-%-get:
	make -f coq-addons/$*.addon get

addon-%-build:
	make -f coq-addons/$*.addon build

addons-get: ${foreach v,$(ADDONS),addon-$(v)-get}
addons-build: ${foreach v,$(ADDONS),addon-$(v)-build}

addons: addons-get addons-build