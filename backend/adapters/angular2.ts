/**
 * Adapter for Angular2
 *
 * An adapter hooks into the live application and broadcasts events related to
 * the state of the components (e.g. mount ops/locations, state changes,
 * performance profile, etc...).
 *
 * For more information, see the Base Adapater (./base.ts).
 *
 * NOTE: This is (definitely) a work in progress. Currently, for the adapter to
 *       function properly, the root of the application must be bound to a
 *       DebugElementViewListener.
 *
 * We infer the root element of our application by finding the first DOM element
 * with an `ngid` attribute (put there by DebugElementViewListener). Component
 * events are indicated by DOM mutations.
 *
 * Interface:
 * - setup
 * - cleanup
 * - subscribe
 * - serializeComponent
 *
 * Supports up to 2.0.0-alpha.40
 */

interface DebugElement {
  componentInstance: any;
  nativeElement: any;
  elementRef: Object;
  getDirectiveInstance: Function;
  children: DebugElement[];
  componentViewChildren: DebugElement[];
  _elementInjector: any;
  triggerEventHandler(eventName: string, eventObj: Event): void;
  hasDirective(type: any): boolean;
  inject(type: any): any;
  getLocal(name: string): any;
  query(p: any, s: Function): DebugElement;
  queryAll(p: any, s: Function): DebugElement[];
}
declare var ng: { probe: Function };


import { TreeNode, BaseAdapter } from './base';
import {DirectiveProvider} from 'angular2/src/core/linker/element_injector';
// import { inspectNativeElement }
//   from 'angular2/src/core/debug/debug_element_view_listener';

export class Angular2Adapter extends BaseAdapter {
  _observer: MutationObserver;

  setup(): void {
    const roots = this._findRoots();

    roots.forEach((root, idx) => {
      this._traverseTree(ng.probe(root),
                         this._emitNativeElement,
                         true,
                         String(idx));
    }, true);
    roots.forEach(root => this._trackChanges(root));
  }

  serializeComponent(el: Element, event: string): TreeNode {
    const debugEl = ng.probe(el);
    const id = this._getComponentID(debugEl);
    const name = this._getComponentName(debugEl);
    const state = this._normalizeState(name, this._getComponentState(debugEl));
    const input = this._getComponentInput(debugEl);
    const output = this._getComponentOutput(debugEl);
    const lastTickTime = this._getComponentPerf(debugEl);

    return {
      id,
      name,
      state,
      input,
      output,
      lastTickTime,
      __meta: {
        event
      }
    };
  }

  cleanup(): void {
    this._removeAllListeners();
    this.unsubscribe();
  }

  _rootSelector(): string {
    // Taken from debug_element_view_listener.ts
    const NG_ID_PROPERTY = 'ngid';
    const NG_ID_SEPARATOR = '#';


    return `[data-${ NG_ID_PROPERTY }='0${ NG_ID_SEPARATOR }0']`;
  }

  _findRoots(): Element[] {
    const roots = document.body.querySelectorAll(this._rootSelector());

    return Array.prototype.slice.call(roots);
  }

  _traverseTree(compEl: DebugElement, cb: Function, isRoot: boolean,
    idx: string): void {
    cb(compEl, isRoot, idx);

    const lightDOMChildren = this._getComponentNestedChildren(compEl);
    const rootChildren = this._getComponentChildren(compEl);

    if (!lightDOMChildren.length && !rootChildren.length) {
      return;
    }

    const children = lightDOMChildren.length && lightDOMChildren ||
                     rootChildren.length && rootChildren;

    children.forEach((child: DebugElement, childIdx: number) => {
      this._traverseTree(child,
                         cb,
                         false,
                         [idx, childIdx].join('.'));
    });
  }

  _emitNativeElement = (compEl: DebugElement, isRoot: boolean,
    idx: string): void => {
    const nativeElement = this._getNativeElement(compEl);

    (<HTMLElement>nativeElement).setAttribute('batarangle-id', idx);

    if (isRoot) {
      return this.addRoot(this._getNativeElement(compEl));
    }

    this.addChild(this._getNativeElement(compEl));
  };

  _trackChanges(el: Element): void {
    this._observer = new MutationObserver(this._handleChanges);

    this._observer.observe(el, {
      attributes: true,
      childList: true,
      characterData: true,
      subtree: true
    });
  }

  _handleChanges = (mutations: MutationRecord[]): void => {
    this.reset();

    // Our handling of the change events will, in turn, cause DOM mutations
    // (e.g setting)
    this._observer.disconnect();

    const roots = this._findRoots();

    roots.forEach((root, idx) => {
      this._traverseTree(
        ng.probe(root),
        this._emitNativeElement,
        true,
        String(idx)
      );
    }, true);

    roots.forEach(root => this._trackChanges(root));
  };

  _getComponentChildren(compEl: DebugElement): DebugElement[] {
    return compEl.componentViewChildren;
  }

  _getComponentNestedChildren(compEl: DebugElement): DebugElement[] {
    return compEl.children;
  }

  _getNativeElement(compEl: DebugElement): Element {
    return compEl.nativeElement;
  }

  _removeAllListeners(): void {
    this._observer.disconnect();
  }

  _isRootNode(el: Element): boolean {
    let id = el.getAttribute('ngid');

    if (!id) {
      return false;
    }

    return this._selectorMatches(el, this._rootSelector());
  }

  _selectorMatches(el: Element, selector: string): boolean {
    function genericMatch(s: string): boolean {
      return [].indexOf.call(document.querySelectorAll(s), this) !== -1;
    }

    const p = <any>Element.prototype;
    const f = p.matches ||
              p.webkitMatchesSelector ||
              p.mozMatchesSelector ||
              p.msMatchesSelector ||
              genericMatch;

    return f.call(el, selector);
  }

  _getComponentInstance(compEl: DebugElement): Object {
    // fix could be undefined (are we grabbing the right element?)
    return compEl.componentInstance || {};
  }

  _getComponentRef(compEl: DebugElement): Element {
    return compEl.nativeElement;
  }

  _getComponentID(compEl: DebugElement): string {
    return this._getComponentRef(compEl).getAttribute('batarangle-id');
    // return this._getComponentRef(compEl).getAttribute('data-ngid')
    //                                     .replace(/#/g, '.');
  }

  _getComponentName(compEl: DebugElement): string {
    const constructor =  <any>this._getComponentInstance(compEl)
                                  .constructor;
    const constructorName = constructor.name;

    // Cover components not backed by a custom class.
    return constructorName !== 'Object' ?
           constructorName :
           this._getComponentRef(compEl).tagName;
  }

  _isSerializable(val: any) {
    try {
      JSON.stringify(val);
    } catch (error) {
      return false;
    }

    return true;
  }

  _getComponentState(compEl: DebugElement): Object {
    const ret = {};
    const instance = this._getComponentInstance(compEl);

    Object.keys(instance).forEach((key) => {
      const val = instance[key];

      if (!this._isSerializable(val)) {
        return;
      }

      ret[key] = val;
    });

    return ret;
  }

  _getComponentInput(compEl: DebugElement): Object {
    const props = {};
    if (compEl._elementInjector) {
      const protoInjector = compEl._elementInjector._injector._proto;
      for (let i = 0; i < protoInjector.numberOfProviders; i++) {
        let provider = protoInjector.getProviderAtIndex(i);
        if (provider instanceof DirectiveProvider) {
          props[provider.displayName] = provider.metadata.events;
        }
      }
    }
    return props;
  }

  _getComponentOutput(compEl: DebugElement): Object {
    const events = {};
    if (compEl._elementInjector) {
      const protoInjector = compEl._elementInjector._injector._proto;
      for (let i = 0; i < protoInjector.numberOfProviders; i++) {
        let provider = protoInjector.getProviderAtIndex(i);
        if (provider instanceof DirectiveProvider) {
          events[provider.displayName] = provider.metadata.events;
        }
      }
    }
    return events;
  }

  _getComponentPerf(compEl: DebugElement): number {
    return 0;
  }

  _normalizeState(name: string, state: Object): Object {
    switch (name) {
      case 'NgFor':
        return this._normalizeNgFor(state);
      case 'NgIf':
        return this._normalizeNgIf(state);
      case 'NgClass':
        return this._normalizeNgClass(state);
      case 'NgSwitch':
        return this._normalizeNgSwitch(state);
      case 'NgStyle':
        return this._normalizeNgStyle(state);
      default:
        return state;
    }
  }

  _normalizeNgIf(state: any): Object {
    return {
      condition: state._prevCondition
    };
  }

  _normalizeNgFor(state: any): Object {
    return {
      // TODO: needs investigation on what this is/does
      // iterableDiffers: state._iterableDiffers,
      length: state._ngForOf.length,
      items: state._ngForOf
    };
  }

  _normalizeNgClass(state: any): Object {
    return {
      // TODO: needs investigation on what these are
      // iterableDiffers: state._iterableDiffers,
      // keyValueDiffers: state._keyValueDiffers,
      // differ: state._differ,
      evaluationMode: state._mode,
      initialClasses: state._initialClasses,
      evaluatedClasses: state._rawClass
    };
  }

  _normalizeNgSwitch(state: any): Object {
    return {
      activeViews: state._activeViews,
      switchValue: state._switchValue,
      useDefault: state._useDefault,
      views: state._valueViews
    };
  }

  _normalizeNgStyle(state: any): Object {
    return {
      styles: state._rawStyle
      // differ: state._differ
    };
  }
}
