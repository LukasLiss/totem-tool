import React, { useEffect } from "react";

import {
  GridStackProvider,
  GridStackRender,
  GridStackRenderProvider,
} from "./gridstack/lib";
import "./styles/grid_demo.css";

export function Grid() {
    // _________________________________________________
    // Initialize Gridstack inside useEffect so that DOM is rendered when its initialized
    // _________________________________________________
    useEffect(() => {
        var grid = GridStack.init();
    });
    // _________________________________________________
    // _________________________________________________

    return (
            <div className="grid-stack">
                <div className="grid-stack-item border-dark" data-gs-width="4" data-gs-height="4">
                    <div className="grid-stack-item-content">Item 1</div>
                </div>
                <div className="grid-stack-item border-dark" data-gs-width="4" data-gs-height="4">
                    <div className="grid-stack-item-content">Item 2</div>
                </div>
                <div className="grid-stack-item border-dark" data-gs-width="4" data-gs-height="4">
                    <div className="grid-stack-item-content">Item 3</div>
                </div>
            </div>

    );
}

export default Grid;