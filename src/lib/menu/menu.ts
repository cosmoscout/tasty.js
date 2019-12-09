import {fromEvent, merge, Observable, Subject} from 'rxjs';
import {Group, PaperScope, Path, Point, Project, Size} from 'paper';
import MenuItem from "./menu-item";
import Settings from "../settings";
import {ClickState, DragState, ItemState, SettingsGroup} from "../enums";
import {filter, finalize, map, mergeMap, switchMap, takeUntil, timeoutWith} from "rxjs/operators";
import Animation from "../../utlis/animation";
import Trace from "../../utlis/trace";
import {ZERO_POINT} from "../constants";
import {DragDefinition, Input, MenuData, MenuEventDefinition, SettingsDefinition} from "../interfaces";
import ColorFactory from "../../utlis/color-factory";

/**
 * Main menu holding all items and input observables
 */
export default class Menu implements MenuData {
    /**
     * Time between MouseDown and MouseUp to generate a click event
     *
     * @type {number}
     * @constant
     * @readonly
     */
    private static readonly INPUT_TIMEOUT: number = 200;

    // Observables
    /**
     * Subject to manually trigger a input activation
     *
     */
    public readonly inputActivation$: Subject<Input>;

    /**
     * Subject to manually trigger a input de-activation
     */
    public readonly inputDeactivation$: Subject<Input>;

    /**
     * Input position observable
     * Emits if input device position changes
     *
     * @type {Subject<Point>}
     */
    public readonly inputPosition$: Subject<Point>;

    /**
     * Value from observable
     *
     * @see {inputPosition$}
     * @type {Point}
     */
    private _inputPosition: Point = ZERO_POINT;

    /**
     * Emits if input device clicks
     *
     * @type {Observable<ClickState>}
     */
    private readonly _click$: Subject<ClickState>;

    /**
     * Emits if input device drags
     *
     * @type {Observable<Point>}
     */
    private readonly _dragging$: Subject<DragDefinition>;


    /**
     * HTML Element selector passed to `document.querySelector`
     *
     * @type {string}
     */
    private readonly _rootSelector: string;

    /**
     * The HTML Element matched by `_rootSelector`
     *
     * @see {_rootSelector}
     * @type {HTMLElement}
     */
    private _root: HTMLElement | undefined;

    /**
     * Canvas for paper.js
     *
     * @type {HTMLCanvasElement}
     */
    private _canvas: HTMLCanvasElement | undefined;

    /**
     * Paper _scope containing all menu items
     *
     * @type {PaperScope}
     */
    private _scope: PaperScope | undefined;

    /**
     * Root menu item generated by the MenuParser
     *
     * @type {MenuItem}
     */
    private _rootItem: MenuItem | undefined;

    /**
     * Settings object
     *
     * @type {Settings}
     * @readonly
     */
    private readonly _settings: Settings;

    /**
     * Fade in animation for _root item after activation
     *
     * @type {Animation}
     * @readonly
     */
    private readonly _fadeAnimation: Animation;

    /**
     * A trace performed by the input
     *
     * @type {Trace}
     * @readonly
     */
    private readonly _trace: Trace;

    /**
     * For debug purposes
     * Holds decision point and trace dots
     *
     * @type {Group}
     * @debug
     */
    private _traceVisGroup: Group | undefined;

    /**
     * Flag if Menu is in marking mode
     *
     * @type {boolean} false
     */
    private _markingMode: boolean = false;

    /**
     *
     * @param {string} rootSelector
     * @see {_rootSelector}
     * @param {SettingsDefinition | Record<string, any>} settings={} Object gets merged with default _settings
     * @constructor
     */
    public constructor(rootSelector: string, settings: Record<string, any> | SettingsDefinition = {}) {
        this._rootSelector = rootSelector;
        this._settings = new Settings(settings);
        this._fadeAnimation = new Animation();
        this._trace = new Trace(this._settings);


        this.inputActivation$ = new Subject<Input>();
        this.inputDeactivation$ = new Subject<Input>();
        this.inputPosition$ = new Subject<Point>();

        this._dragging$ = new Subject<DragDefinition>();
        this._click$ = new Subject<ClickState>();
    }


    /**
     * @see {_inputPosition}
     * @return {Observable<Point>}
     */
    public get inputPosition(): Point {
        return this._inputPosition;
    }

    /**
     * @see {_click$}
     * @see {ClickState}
     * @return {Observable<ClickState>}
     * @throws {Error} If menu hast not been initialized
     */
    public get click$(): Observable<ClickState> {
        if (typeof this._click$ === "undefined") {
            throw new Error('Menu not initialized');
        }

        return this._click$.asObservable();
    }

    /**
     * @see {_dragging$}
     * @return {Observable<DragDefinition>}
     * @throws {Error} If menu hast not been initialized
     */
    public get dragging$(): Observable<DragDefinition> {
        if (typeof this._dragging$ === "undefined") {
            throw new Error('Menu not initialized');
        }

        return this._dragging$.asObservable();
    }

    /**
     * Menu selection events observable
     *
     * @return {Observable<MenuEventDefinition>}
     * @throws {Error} If menu hast not been initialized
     */
    public get selection$(): Observable<MenuEventDefinition> {
        if (typeof this._rootItem === "undefined") {
            throw new Error('Menu not initialized');
        }

        return this._rootItem.selection$;
    }

    /**
     * @see {Trace}
     * @return {Observable<Point>}
     */
    public get trace$(): Trace {
        return this._trace;
    }

    /**
     * @see {_markingMode}
     * @return {boolean}
     */
    public get markingMode(): boolean {
        return this._markingMode;
    }

    /**
     * @return {HTMLCanvasElement}
     */
    public get canvas(): HTMLCanvasElement {
        if (typeof this._canvas === "undefined") {
            throw new Error("Canvas not initialized in menu");
        }

        return this._canvas;
    }


    /**
     * Initializes the menu, sets up the canvas and scope
     *
     * @throws {Error} if _rootSelector matches nothing
     * @see {_rootSelector}
     */
    public init(): void {
        let root = document.querySelector(this._rootSelector) as HTMLElement;

        if (root === null) {
            throw new Error(`No element matching '${this._rootSelector}' found.`);
        }

        this._root = root;

        this.setupCanvas();
        this.setupScope();
        this.setupObservables();
        this.resize();

        if (this._settings[SettingsGroup.MAIN].enableAutoResize) {
            window.addEventListener('resize', () => {
                this.resize();
            });
        }

        if (typeof window.PointerEvent === "undefined") {
            this.setupObservableDataFromInputEvents();
        } else {
            this.setupObservableDataFromInputEvents();
            // This is definitely a TODO
            //this.setupObservableDataFromPointerEvents();
        }

        this._traceVisGroup = new Group();
    }

    /**
     * Displays the menu on the last input position
     *
     * @throws {Error} If menu hast not been initialized
     * @see {init}
     */
    public display(): void {
        if (this._rootItem === undefined) {
            throw new Error(`Menu not initialized.`);
        }

        if (this._rootItem.state === ItemState.HIDDEN || this._rootItem.state === ItemState.NONE) {
            this.trace$.reset();
            (this._traceVisGroup as Group).removeChildren();
            this._fadeAnimation.stop();

            this._rootItem.visible = true;
            this._fadeAnimation.start();
            this._rootItem.state = ItemState.ACTIVE;
            this._rootItem.redraw();
            this._rootItem.position = this.inputPosition;
        }
    }

    /**
     * Set the menu structure generated by MenuParser
     *
     * @param {MenuItem} structure
     */
    public setStructure(structure: MenuItem): void {
        this._rootItem = structure;
        this._rootItem.menu = this;
        this._rootItem.settings = this._settings;
        this._rootItem.init();
        this._rootItem.visible = false;
        this._fadeAnimation.initialize({
            target: this._rootItem,
            from: {
                opacity: 0,
            },
            to: {
                opacity: 1
            }, options: {
                duration: this._settings[SettingsGroup.MAIN].animationDuration,
                easing: 'easeOutCubic'
            }
        });
    }

    /**
     * Set the canvas size to window.innerWidth / height
     */
    public resize(): void {
        if (!window) {
            return;
        }

        this._scope.project.view.viewSize = new Size(window.innerWidth, window.innerHeight);
    }

    /**
     * Sets up the paper.js canvas
     * Disables the context menu and resizes it to full screen
     *
     * @throws {Error} If root element is missing
     * @see {_root}
     */
    private setupCanvas(): void {
        if (typeof this._root === "undefined") {
            throw new Error(`Root element '${this._rootSelector}' missing.`);
        }

        this._canvas = document.createElement('canvas') as HTMLCanvasElement;
        this._canvas.addEventListener('contextmenu', (e): void => e.preventDefault());
        this._canvas.setAttribute('data-paper-resize', 'true');
        this._canvas.setAttribute('tabindex', '1');
        (this._canvas.style as any)['touch-action'] = 'none';
        (this._canvas.style as any)['outline'] = 'none';

        this._root.appendChild(this._canvas);
    }

    /**
     * Sets up the paper.js scope
     *
     * @throws {Error} If the paper canvas is not initialized
     */
    private setupScope(): void {
        this._scope = new PaperScope();
        this._scope.settings.insertItems = false;
        this._scope.settings.applyMatrix = false;
        this._scope.activate();
        this._scope.setup(this.canvas);
        //@ts-ignore
        (this._scope.project as Project).currentStyle = this._settings.projectStyle;
    }


    /**
     * Sets up needed Observable data mapping and subscribing
     */
    private setupObservables(): void {
        // Manually creating dragging events from Inputs
        // TODO!
        this.inputActivation$.pipe(
            filter((e: Input): boolean => e.buttons === 1),
            switchMap((): Observable<DragDefinition> => this.inputPosition$.pipe(
                map((position: Point): DragDefinition => {
                    return {
                        position,
                        state: DragState.DRAGGING
                    };
                }),
                takeUntil(this.inputDeactivation$),
                finalize((): void => {
                    if (this._markingMode) {
                        this._markingMode = false;
                        (this._dragging$ as Subject<DragDefinition>).next({
                            position: this.inputPosition,
                            state: DragState.END
                        });
                    }
                }))),
        ).subscribe(this._dragging$);

        this.inputActivation$.pipe(
            mergeMap((): Observable<ClickState> => {
                // @ts-ignore
                return this.inputDeactivation$.pipe(
                    // Holding mouse button too long wont trigger a click event | TODO
                    timeoutWith(Menu.INPUT_TIMEOUT, new Observable()),
                    map((e: Input): ClickState => {
                        if (e.button === 0) {
                            return ClickState.LEFT_CLICK;
                        } else {
                            return ClickState.RIGHT_CLICK;
                        }
                    })
                );
            }),
        ).subscribe(this._click$);

        this._dragging$.subscribe((drag: DragDefinition): void => {
            this.display();
            this._markingMode = drag.state !== DragState.END;
            this._trace.update(drag.position);
        });

        this.inputPosition$.subscribe((position: Point): void => {
            this._inputPosition = position;
        });

        this._click$.subscribe((e: ClickState): void => {
            if (e === ClickState.LEFT_CLICK) {
                this.display();
            }
        });
    }

    /**
     * Sets up observables from PointerEvent
     */
    // @ts-ignore for now
    private setupObservableDataFromPointerEvents(): void {
        const inputMove = this.createObserver('pointermove');
        const inputUp = merge(this.createObserver('pointerup'), this.createObserver('pointercancel'));
        const inputDown = this.createObserver('pointerdown');
        const inputLeave = merge(this.createObserver('pointerleave'), this.createObserver('pointerout'));

        inputDown.subscribe(this.inputActivation$);
        inputUp.subscribe(this.inputDeactivation$);
        inputLeave.subscribe(this.inputDeactivation$);

        inputMove.pipe(
            map((e: MouseEvent): Point => {
                return new Point(
                    e.clientX,
                    e.clientY
                );
            })
        ).subscribe(this.inputPosition$);
    }

    /**
     * Sets up observables from Touch and Mouse Events
     */
    private setupObservableDataFromInputEvents(): void {
        const touchMove = this.createObserver('touchmove');
        const touchEnd = this.createObserver('touchend');
        const touchStart = this.createObserver('touchdown');
        const touchCancel = this.createObserver('touchcancel');

        const mouseMove = this.createObserver('mousemove');
        const mouseUp = this.createObserver('mouseup');
        const mouseDown = this.createObserver('mousedown');
        const mouseLeave = this.createObserver('mouseleave');

        const inputMove = merge(mouseMove, touchMove);
        const inputUp = merge(touchEnd, mouseUp);
        const inputDown = merge(touchStart, mouseDown);
        const inputLeave = merge(touchCancel, mouseLeave);


        inputDown.subscribe(this.inputActivation$);
        inputUp.subscribe(this.inputDeactivation$);
        inputLeave.subscribe(this.inputDeactivation$);


        inputMove.pipe(
            map((e: MouseEvent): Point => {
                return new Point(
                    e.clientX,
                    e.clientY
                );
            })
        ).subscribe(this.inputPosition$);
    }

    /**
     * Creates an observable from an event on the paper canvas
     *
     * @param {string} event
     * @return {Observable<MouseEvent>}
     */
    private createObserver(event: string): Observable<MouseEvent> {
        return (fromEvent((this._canvas as HTMLCanvasElement), event) as Observable<MouseEvent>);
    }

    /**
     * Debug Method
     */
    public drawTrace(): void {
        if (typeof this._traceVisGroup === "undefined") {
            throw new Error(`Trace visualization group not initialized`);
        }

        if (typeof this._scope === "undefined") {
            throw new Error(`Scope not set`);
        }

        (this._scope.project as Project).activeLayer.addChild(this._traceVisGroup);

        this._trace.onDecisionPoint$.subscribe((point): void => {
            const p = new Path.Circle(point, 5);
            p.fillColor = ColorFactory.fromString('green');
            (this._traceVisGroup as Group).addChild(p);
        });

        (this._dragging$ as Observable<DragDefinition>).subscribe((drag: DragDefinition): void => {
            const p = new Path.Circle(drag.position, 2);
            p.fillColor = ColorFactory.fromString('black');
            (this._traceVisGroup as Group).addChild(p);
        });
    }
}
