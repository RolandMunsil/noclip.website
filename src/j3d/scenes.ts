
import { BMD, BTK, BMT } from './j3d';
import { Scene } from './render';
import * as GX_Material from 'gx/gx_material';
import * as RARC from './rarc';
import * as Yaz0 from '../yaz0';
import * as Viewer from '../viewer';

import Progressable from 'Progressable';
import { RenderPass, RenderState } from '../render';
import { assert, fetch, readString } from '../util';
import ArrayBufferSlice from 'ArrayBufferSlice';

export class MultiScene implements Viewer.MainScene {
    public scenes: Scene[];
    public textures: Viewer.Texture[];

    constructor(scenes: Scene[]) {
        this.setScenes(scenes);
    }

    protected setScenes(scenes: Scene[]) {
        this.scenes = scenes;
        this.textures = [];
        for (const scene of this.scenes)
            this.textures = this.textures.concat(scene.textures);
    }

    public render(renderState: RenderState) {
        this.scenes.forEach((scene) => {
            scene.render(renderState);
        });
    }

    public destroy(gl: WebGL2RenderingContext) {
        this.scenes.forEach((scene) => scene.destroy(gl));
    }
}

export function createScene(gl: WebGL2RenderingContext, bmdFile: RARC.RARCFile, btkFile: RARC.RARCFile, bmtFile: RARC.RARCFile) {
    const bmd = BMD.parse(bmdFile.buffer);
    const btk = btkFile ? BTK.parse(btkFile.buffer) : null;
    const bmt = bmtFile ? BMT.parse(bmtFile.buffer) : null;
    return new Scene(gl, bmd, btk, bmt);
}

export function createScenesFromBuffer(gl: WebGL2RenderingContext, buffer: ArrayBufferSlice): Scene[] {
    if (readString(buffer, 0, 4) === 'Yaz0')
        buffer = Yaz0.decompress(buffer);

    if (readString(buffer, 0, 4) === 'RARC') {
        const rarc = RARC.parse(buffer);
        const bmdFiles = rarc.files.filter((f) => f.name.endsWith('.bmd') || f.name.endsWith('.bdl'));
        const scenes = bmdFiles.map((bmdFile) => {
            // Find the corresponding btk.
            const basename = bmdFile.name.split('.')[0];
            const btkFile = rarc.files.find((f) => f.name === `${basename}.btk`);
            const bmtFile = rarc.files.find((f) => f.name === `${basename}.bmt`);
            try {
                return createScene(gl, bmdFile, btkFile, bmtFile);
            } catch(e) {
                console.log("Error parsing", bmdFile.name);
                return null;
            }
        });

        return scenes.filter((s) => !!s);
    }

    if (['J3D2bmd3', 'J3D2bdl4'].includes(readString(buffer, 0, 8))) {
        const bmd = BMD.parse(buffer);
        return [new Scene(gl, bmd, null, null)];
    }

    return null;
}

export function createMultiSceneFromBuffer(gl: WebGL2RenderingContext, buffer: ArrayBufferSlice): MultiScene {
    return new MultiScene(createScenesFromBuffer(gl, buffer));
}
