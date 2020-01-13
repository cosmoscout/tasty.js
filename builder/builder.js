class TastyBuilder {
    /**
     * @type {HTMLElement}
     */
    _canvasContainer;

    /**
     * @type {tasty.parser}
     */
    _parser;

    /**
     * @type {tasty.menu}
     */
    _menu;

    /**
     * @type {Map<string, MenuItem>}
     */
    _menuMap;

    /**
     * @type {string}
     */
    _rootId;

    /**
     * @type {Object}
     */
    _structure;

    constructor() {
        this._menuMap = new Map();
        this._parser = new tasty.parser();
        this._canvasContainer = document.getElementById('canvas');

        this._menu = new tasty.menu('#canvas' /* The element to place the menu into */, {
            // Configuration object
            // These are the defaults
            main: {
                minDistance: 150,
                minTraceDistance: 175,
                animationDuration: 250,
                enableMaxClickRadius: false,
            },
        });

        this._menu.init();

        this._typeToggler();

        document.getElementById('editor').addEventListener('submit', this._compile.bind(this));
    }

    _typeToggler() {
        document.getElementById('type').addEventListener('change', (e) => {
            document.getElementById('slider-settings').classList.remove('active');
            document.getElementById('checkbox-settings').classList.remove('active');

            switch (e.target.value) {
                case 'checkbox':
                    document.getElementById('checkbox-settings').classList.add('active');
                    break;

                case 'slider':
                    document.getElementById('slider-settings').classList.add('active');
                    break;
            }
        });
    }

    /**
     *
     * @param {Event} event
     * @private
     */
    _compile(event) {
        event.preventDefault();
        const item = this._loadFormData(event.target);

        if (this._menuMap.has(item.id) || item.id === '') {
            document.getElementById('itemId').classList.add('is-invalid');
            return;
        } else {
            document.getElementById('itemId').classList.remove('is-invalid');
        }

        this._addParentOption(item);
        this._menuMap.set(item.id, this._parser.parseItem(item));

        if (typeof this._structure === "undefined") {
            this._structure = item;
            this._rootId = item.id;
        } else {
            this._menuMap.get(item.parent).addChild(this._menuMap.get(item.id));

            this._structure = this._menuMap.get(this._rootId).toJSON();
        }

        document.getElementById('output').innerText = JSON.stringify(this._structure, null, 2);
        this._displayMenu();
    }

    /**
     *
     * @param form
     * @return {{parent, icon: *, id: *, text: *, type, direction: *}}
     * @private
     */
    _loadFormData(form) {
        const item = {
            id: form.itemId.value,
            text: form.text.value,
            icon: form.icon.value,
            direction: form.direction.value,
            type: form.type.value,
            parent: form.parent.value,
        };

        if (item.type === 'checkbox') {
            item.data = {
                selected: form.checkbox.checked === true,
            };
        } else if (item.type === 'slider') {
            item.data = {
                min: Number(form['slider-min'].value),
                max: Number(form['slider-max'].value),
                initial: Number(form['slider-initial'].value),
                precision: Number(form['slider-precision'].value),
                stepDist: Number(form['slider-step-dist'].value),
                stepSize: Number(form['slider-step-size'].value),
            };
        }

        return item;
    }

    /**
     * Adds the parent as an option
     * @param item
     * @private
     */
    _addParentOption(item) {
        if (this._menuMap.has(item.id)) {
            return;
        }

        const option = document.createElement('option');
        option.value = item.id;
        option.innerText = `${item.text} - ${item.id}`;

        document.getElementById('parent').appendChild(option);
    }

    /**
     * Parse the struct and display the menu centered
     * @private
     */
    _displayMenu() {
        this._menu._scope.project.clear();
        this._menu.setStructure((new tasty.parser()).parse(this._structure));
        this._menu.display({
            x: this._canvasContainer.offsetWidth / 2,
            y: this._canvasContainer.offsetHeight / 2
        });
    }
}