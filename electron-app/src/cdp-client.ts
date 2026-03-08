
import { BrowserView, WebContents } from 'electron';

export class CdpClient {
    private view: BrowserView | null = null;
    private attached = false;

    constructor() { }

    public attach(view: BrowserView) {
        this.view = view;
        try {
            if (!this.view.webContents.debugger.isAttached()) {
                this.view.webContents.debugger.attach('1.3');
                this.attached = true;
                this.view.webContents.debugger.sendCommand('Accessibility.enable');
                console.log('[GhostPilot] Debugger attached & Accessibility enabled');
            }
        } catch (err) {
            console.error('[GhostPilot] Debugger attach failed:', err);
        }
    }

    public async handleAction(payload: any): Promise<any> {
        if (!this.view || !this.attached) {
            throw new Error('Ghost Pilot not attached to browser');
        }

        const { action, selector, text, x, y, from, to } = payload;
        console.log(`[GhostPilot] Action: ${action}`, payload);

        switch (action) {
            case 'click':
                if (selector) return this.clickSelector(selector);
                if (x !== undefined && y !== undefined) return this.clickCoordinates(x, y);
                throw new Error('Click requires selector or x,y');
            case 'type':
                return this.typeText(text || '');
            case 'screenshot':
                return this.captureScreenshot();
            case 'eval':
                return this.evalExpression(text || '');
            case 'tree':
                return this.getAccessibilityTree();
            default:
                throw new Error(`Unknown action: ${action}`);
        }
    }

    private async sendCommand(method: string, params: any = {}): Promise<any> {
        return this.view!.webContents.debugger.sendCommand(method, params);
    }

    private async evalExpression(expression: string): Promise<any> {
        const res = await this.sendCommand('Runtime.evaluate', { expression, returnByValue: true });
        return res.result.value;
    }

    private async getBoxModel(selector: string) {
        const doc = await this.sendCommand('DOM.getDocument');
        const node = await this.sendCommand('DOM.querySelector', {
            nodeId: doc.root.nodeId,
            selector: selector,
        });
        if (!node.nodeId) throw new Error(`Node not found: ${selector}`);

        const model = await this.sendCommand('DOM.getBoxModel', { nodeId: node.nodeId });
        return model.model;
    }

    private async clickSelector(selector: string) {
        const box = await this.getBoxModel(selector);
        const center = box.content; // [x1,y1, x2,y2, x3,y3, x4,y4]
        // simple center calc
        const x = (center[0] + center[2]) / 2;
        const y = (center[1] + center[5]) / 2;
        return this.clickCoordinates(x, y);
    }

    private async clickCoordinates(x: number, y: number) {
        await this.sendCommand('Input.dispatchMouseEvent', {
            type: 'mousePressed',
            x, y,
            button: 'left',
            clickCount: 1
        });
        await this.sendCommand('Input.dispatchMouseEvent', {
            type: 'mouseReleased',
            x, y,
            button: 'left',
            clickCount: 1
        });
        return { success: true, x, y };
    }

    private async typeText(text: string) {
        // We use insertText for simplicity as it handles most input fields
        await this.sendCommand('Input.insertText', { text });
        return { success: true };
    }

    private async captureScreenshot() {
        const res = await this.sendCommand('Page.captureScreenshot', { format: 'png' });
        return { success: true, data: res.data }; // base64
    }

    private async getAccessibilityTree() {
        try {
            const { nodes } = await this.sendCommand('Accessibility.getFullAXTree');
            // Filter to useful nodes to reduce token count
            const useful = nodes.filter((n: any) =>
                n.role.type !== 'generic' &&
                n.role.type !== 'group' &&
                (n.name?.value || n.role.value === 'button' || n.role.value === 'link' || n.role.value === 'input')
            );
            return { success: true, count: useful.length, tree: useful.slice(0, 100) }; // Limit size
        } catch (e: any) {
            return { success: false, error: e.message };
        }
    }
}
