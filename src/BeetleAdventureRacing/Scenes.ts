
import { CameraController } from "../Camera";
import { Color, colorFromHSL, colorNewFromRGBA } from "../Color";
import { drawWorldSpaceAABB, drawWorldSpacePoint, drawWorldSpaceVector, getDebugOverlayCanvas2D } from "../DebugJunk";
import { AABB } from "../Geometry";
import { BasicRenderTarget, makeClearRenderPassDescriptor } from "../gfx/helpers/RenderTargetHelpers";
import { GfxDevice, GfxHostAccessPass, GfxRenderPass, GfxRenderPassDescriptor } from "../gfx/platform/GfxPlatform";
import { executeOnPass } from "../gfx/render/GfxRenderer";
import { GfxRenderHelper } from "../gfx/render/GfxRenderGraph";
import { Destroyable, SceneContext, SceneDesc, SceneGroup } from "../SceneBase";
import * as UI from '../ui';
import { assert } from "../util";
import { SceneGfx, ViewerRenderInput } from "../viewer";
import { Filesystem, loadFilesystem } from "./Filesystem";
import { UVEN, UVENRenderer } from "./ParsedFiles/UVEN";
import { UVTR, UVTRRenderer } from "./ParsedFiles/UVTR";
import { UVTS } from "./ParsedFiles/UVTS";
import { TexScrollAnim, TexSeqAnim, UVTX } from "./ParsedFiles/UVTX";
import { CourseTrackData, getTrackData, TrackDataRenderer, TranslucentPlaneRenderer } from "./TrackData";
import { vec3, vec4 } from "gl-matrix";
import { parse } from "../oot3d/cmb";

export const DEBUGGING_TOOLS_STATE = {
    showTextureIndices: false,
    singleUVTXToRender: null//0x270
};

export class RendererStore implements Destroyable {
    public objToRendererMap: Map<any, any> = new Map();

    public getOrCreateRenderer<TObj, TRenderer>(obj: TObj, createLambda: () => TRenderer): TRenderer {
        let cachedRenderer = this.objToRendererMap.get(obj);
        if (cachedRenderer !== undefined) {
            return <TRenderer>cachedRenderer;
        } else {
            let newRenderer = createLambda();
            this.objToRendererMap.set(obj, newRenderer);
            return newRenderer;
        }
    }

    public destroy(device: GfxDevice): void {
        for (let renderer of this.objToRendererMap.values()) {
            if (renderer.destroy)
                renderer.destroy(device);
        }
    }
}

// This needs to be a global because of how noclip compares binding layouts when deciding whether to make a new one
const bindingLayouts = [{ numUniformBuffers: 3, numSamplers: 2 }];

class BARRenderer implements SceneGfx {
    public renderHelper: GfxRenderHelper;
    private renderTarget = new BasicRenderTarget();

    private uvtrRenderer: UVTRRenderer;
    private uvenRenderer: UVENRenderer | null;

    private texScrollAnims: TexScrollAnim[];
    private texSeqAnims: TexSeqAnim[];

    private renderPassDescriptor: GfxRenderPassDescriptor;

    private trackDataRenderer: TrackDataRenderer;

    constructor(device: GfxDevice, rendererStore: RendererStore, uvtr: UVTR, uven: UVEN | null, private sceneIndex: number | null, private filesystem: Filesystem) {
        this.renderHelper = new GfxRenderHelper(device);

        this.uvtrRenderer = rendererStore.getOrCreateRenderer(uvtr, () => new UVTRRenderer(uvtr, device, rendererStore))

        this.uvenRenderer = null;
        if (uven !== null)
            this.uvenRenderer = rendererStore.getOrCreateRenderer(uven, () => new UVENRenderer(uven, device, rendererStore));

        this.texScrollAnims = [];
        this.texSeqAnims = [];
        for (let uvFile of rendererStore.objToRendererMap.keys()) {
            if (uvFile instanceof UVTX) {
                if (uvFile.scrollAnim1 !== null)
                    this.texScrollAnims.push(uvFile.scrollAnim1);
                if (uvFile.scrollAnim2 !== null)
                    this.texScrollAnims.push(uvFile.scrollAnim2);
                if (uvFile.seqAnim !== null) {
                    this.texSeqAnims.push(uvFile.seqAnim);
                }
            }
        }

        if (uven === null) {
            this.renderPassDescriptor = makeClearRenderPassDescriptor(true, colorNewFromRGBA(1, 0, 1));
        } else {
            this.renderPassDescriptor = makeClearRenderPassDescriptor(true, colorNewFromRGBA(uven.clearR / 0xFF, uven.clearG / 0xFF, uven.clearB / 0xFF));
        }

        // TODO: should this be lazy?
        let trackData = getTrackData(this.sceneIndex, this.filesystem);
        if(trackData !== null) {
            this.trackDataRenderer = new TrackDataRenderer(device, trackData)
        }
    }
        

    public adjustCameraController(c: CameraController) {
        c.setSceneMoveSpeedMult(0.02);
    }

    // TODO: enable/disable textures and vertex colors
    // TODO: some sort of checkbox to always use the lowest LOD just for funsies?
    // TODO: show collision data (if that's easy to find)?
    // TODO: Differences between last lap and other laps?
    // TODO: Option to hide the boxes
    public createPanels(): UI.Panel[] {
        const debuggingToolsPanel = new UI.Panel();

        debuggingToolsPanel.customHeaderBackgroundColor = UI.COOL_BLUE_COLOR;
        debuggingToolsPanel.setTitle(UI.RENDER_HACKS_ICON, 'Debug');

        const showTextureIndicesCheckbox = new UI.Checkbox('Show Texture Indices', DEBUGGING_TOOLS_STATE.showTextureIndices);
        showTextureIndicesCheckbox.onchanged = () => {
            DEBUGGING_TOOLS_STATE.showTextureIndices = showTextureIndicesCheckbox.checked;
        };
        debuggingToolsPanel.contents.appendChild(showTextureIndicesCheckbox.elem);

        if(this.trackDataRenderer !== undefined) {
            // TODO: only create this panel if it's possible to load track data
            const trackDataPanel = new UI.Panel();

            trackDataPanel.customHeaderBackgroundColor = UI.COOL_BLUE_COLOR;
            trackDataPanel.setTitle(UI.LAYER_ICON, 'Track Data');

            let addCheckBox = (label: string, setMethod: ((val: boolean) => void)) => {
                let chk = new UI.Checkbox(label);
                chk.onchanged = () => {
                    setMethod(chk.checked);
                };
                trackDataPanel.contents.appendChild(chk.elem);
            }

            addCheckBox("Show track path", val => this.trackDataRenderer.showTrack = val);
            addCheckBox("Also show up direction and width", val => this.trackDataRenderer.alsoShowTrackUpVectorAndWidthVector = val);
            // TODO: no
            trackDataPanel.contents.appendChild(new UI.TextField().elem);
            addCheckBox("Show special reset zones", val => this.trackDataRenderer.showSpecialResetZones = val);
            addCheckBox('Show "progress fix" zones', val => this.trackDataRenderer.showProgressFixZones = val);
            addCheckBox("Show progress values next to points", val => this.trackDataRenderer.showProgressFixZoneValues = val);
            // TODO: no
            trackDataPanel.contents.appendChild(new UI.TextField().elem);
            addCheckBox("Show track segment begin planes", val => this.trackDataRenderer.showTrackSegmentBeginPlanes = val);
            addCheckBox("Show track segment end planes", val => this.trackDataRenderer.showTrackSegmentEndPlanes = val);

            let gridDiv = document.createElement('div');
            gridDiv.style.display = "grid";
            gridDiv.style.gridTemplateColumns = "1fr 1fr 1fr 1fr";
            gridDiv.style.alignItems = "center";
            gridDiv.style.cursor = "pointer";
            gridDiv.style.gridGap = "10px"

            let l1 = document.createElement('div');
            l1.style.userSelect = 'none';
            l1.style.fontWeight = '';
            l1.style.color = '#aaa';
            l1.textContent = "Min seg."

            gridDiv.appendChild(l1);

            let mintf = new UI.TextField();
            let maxtf = new UI.TextField();
            mintf.elem.oninput = () => {
                this.trackDataRenderer.setMinAndMaxSegmentIndices(parseInt(mintf.getValue()), parseInt(maxtf.getValue()));
            };
            maxtf.elem.oninput = () => {
                this.trackDataRenderer.setMinAndMaxSegmentIndices(parseInt(mintf.getValue()), parseInt(maxtf.getValue()));
            };

            gridDiv.appendChild(mintf.elem);

            let l2 = document.createElement('div');
            l2.style.userSelect = 'none';
            l2.style.fontWeight = '';
            l2.style.color = '#aaa';
            l2.textContent = "Max seg."

            gridDiv.appendChild(l2);
            gridDiv.appendChild(maxtf.elem);

            trackDataPanel.contents.append(gridDiv); 


            let gridDiv2 = document.createElement('div');
            gridDiv2.style.display = "grid";
            gridDiv2.style.gridTemplateColumns = "2fr 3fr";
            gridDiv2.style.alignItems = "center";
            gridDiv2.style.cursor = "pointer";
            gridDiv2.style.gridGap = "10px"

            let v1 = document.createElement('div');
            v1.style.userSelect = 'none';
            v1.style.fontWeight = '';
            v1.style.color = '#aaa';
            v1.textContent = "Show progress vals:"

            gridDiv2.appendChild(v1);

            let progtf = new UI.TextField();
            progtf.elem.oninput = () => {
                this.trackDataRenderer.progressValuesToShow = progtf.getValue().split(",").map(s => parseInt(s)).filter(n => !isNaN(n));
            };


            gridDiv2.appendChild(progtf.elem);

            trackDataPanel.contents.append(gridDiv2); 

            return [debuggingToolsPanel, trackDataPanel];
        } else {
            return [debuggingToolsPanel];
        }

        
    }



    // Builds a scene graph and uses the hostAccessPass to upload data to the GPU
    public prepareToRender(device: GfxDevice, hostAccessPass: GfxHostAccessPass, viewerInput: ViewerRenderInput): void {
        viewerInput.camera.setClipPlanes(0.1);

        // Update animations
        let deltaTimeSecs = viewerInput.deltaTime / 1000;
        for (let texScrollAnim of this.texScrollAnims) {
            texScrollAnim.update(deltaTimeSecs);
        }
        for (let texSeqAnim of this.texSeqAnims) {
            texSeqAnim.update(deltaTimeSecs);
        }

        const topTemplate = this.renderHelper.pushTemplateRenderInst();
        // We use the same number of samplers & uniform buffers in every material
        topTemplate.setBindingLayouts(bindingLayouts);

        const renderInstManager = this.renderHelper.renderInstManager;

        // Prep rendering of level and environment
        this.uvtrRenderer.prepareToRender(device, renderInstManager, viewerInput);
        if (this.uvenRenderer !== null)
            this.uvenRenderer.prepareToRender(device, renderInstManager, viewerInput);

        if(this.trackDataRenderer !== undefined)
            this.trackDataRenderer.prepareToRender(device, renderInstManager, viewerInput);

        // Not sure if this is strictly necessary but it can't hurt
        renderInstManager.popTemplateRenderInst();

        // Upload uniform data to the GPU
        this.renderHelper.prepareToRender(device, hostAccessPass);
    }

    public render(device: GfxDevice, viewerInput: ViewerRenderInput): GfxRenderPass | null {

        // Create pass to upload data to the GPU
        // Sidenote: textures, indices, vertices, etc. have already been uploaded (e.g. in the MaterialRenderer constructor)
        // (and under the covers noclip actually creates a host access pass to do this)
        // So the only thing (right now) that this is used for in my code is uploading the uniform buffers.
        // (which happens in renderHelper.prepareToRender())
        const hostAccessPass = device.createHostAccessPass();

        // Build scene graph and send buffers to host access pass
        this.prepareToRender(device, hostAccessPass, viewerInput);

        // Submitting actually performs the upload of the buffers
        device.submitPass(hostAccessPass);

        // renderInstManager manages the scene graph
        const renderInstManager = this.renderHelper.renderInstManager;

        // Define width and height of buffer that we'll be rendering to
        this.renderTarget.setParameters(device, viewerInput.backbufferWidth, viewerInput.backbufferHeight);

        // Now we actually render.
        // This is the final pass, so set colorResolveTo to the onscreen texture
        // renderTarget.createRenderPass will set up the pass to use the renderTarget's textures to store color and depth data
        // (note: an attachment is sort of a reference to a texture)
        // then once it's rendered to those, the color data will be rendered to colorResolveTo (which basically just amounts to scaling it down to achieve antialiasing)
        const renderPass = this.renderTarget.createRenderPass(device, viewerInput.viewport, this.renderPassDescriptor, viewerInput.onscreenTexture);
        executeOnPass(renderInstManager, device, renderPass, 0);
        device.submitPass(renderPass);

        //TODO: snow

        // Now that we're done rendering, clean up the scene graph
        renderInstManager.resetRenderInsts();

        // If we want, we can return our final pass and noclip will submit it and then submit a subsequent pass to render it to viewerInput.onscreenTexture
        // I prefer to just do it all in here so we'll just return null
        return null;
    }

    public destroy(device: GfxDevice): void {
        this.renderHelper.destroy(device);
        this.renderTarget.destroy(device);
    }
}

export const pathBase = `BeetleAdventureRacing`;
class BARSceneDesc implements SceneDesc {
    public id: string;

    // uvtrIndex is there for when we want to load a UVTR that's not part of a scene.
    constructor(public sceneIndex: number | null, public name: string, public uvtrIndex: number | null = null) {
        if (this.sceneIndex !== null) {
            this.id = "sc" + this.sceneIndex;
        } else {
            this.id = "tr" + this.uvtrIndex;
        }
    }

    public async createScene(device: GfxDevice, context: SceneContext): Promise<SceneGfx> {
        const filesystem = await context.dataShare.ensureObject<Filesystem>(`${pathBase}/FilesystemData`, async () => {
            return await loadFilesystem(context.dataFetcher, device);
        });

        let uvtrIndex: number;
        let uvenIndex: number | null = null;

        if (this.sceneIndex !== null) {
            // Scene descriptions are stored in a big array in the data section of the "scene" module's code.
            let sceneModuleCodeChunkBuffer = filesystem.getFile("UVMO", 0x32).chunks[1].buffer;
            // Each description is 0x9c bytes long
            let sceneDescriptionsDataView = sceneModuleCodeChunkBuffer.subarray(0x1840, 0x9c * 0x22).createDataView();

            uvtrIndex = sceneDescriptionsDataView.getInt16(0x9c * this.sceneIndex + 0x0);
            uvenIndex = sceneDescriptionsDataView.getInt16(0x9c * this.sceneIndex + 0x2);
        } else if (this.uvtrIndex !== null) {
            uvtrIndex = this.uvtrIndex;
        } else {
            assert(false);
        }

        // Make sure all the files we need are loaded
        const uvtr = filesystem.getOrLoadFile(UVTR, "UVTR", uvtrIndex);
        let uven: UVEN | null = null;
        if (uvenIndex !== null) {
            uven = filesystem.getOrLoadFile(UVEN, "UVEN", uvenIndex)
        }

        // UVTS files reference UVTX files but are themselves referenced by UVTX files
        // so loading their references immediately would cause infinite recursion.
        // Instead we have to do it after.
        // TODO: should I come up with a better solution for this?
        for (let uvts of filesystem.getAllLoadedFilesOfType<UVTS>("UVTS")) {
            uvts.loadUVTXs(filesystem);
        }

        const rendererStore = await context.dataShare.ensureObject<RendererStore>(`${pathBase}/RendererStore`, async () => {
            return await new RendererStore();
        });

        return new BARRenderer(device, rendererStore, uvtr, uven, this.sceneIndex, filesystem);
    }
}

const id = 'BeetleAdventureRacing';
const name = "Beetle Adventure Racing!";
const sceneDescs = [
    'Tracks',
    new BARSceneDesc(0x5, 'Coventry Cove'),
    new BARSceneDesc(0x7, 'Mount Mayhem'),
    new BARSceneDesc(0x9, 'Inferno Isle'),
    new BARSceneDesc(0x8, 'Sunset Sands'),
    new BARSceneDesc(null, '(chamber under sunset sands)', 0x15),
    new BARSceneDesc(0xA, 'Metro Madness'),
    new BARSceneDesc(0x6, 'Wicked Woods'),
    new BARSceneDesc(0xB, '[Unused] Stunt O\'Rama'),
    //new BARSceneDesc(0xC, 'TRACK 8'),
    //new BARSceneDesc(0xD, 'TRACK 9'),
    //new BARSceneDesc(0xE, 'TRACK 10'),
    'Multiplayer',
    new BARSceneDesc(0x11, 'Airport'),
    new BARSceneDesc(0x12, 'Castle'),
    new BARSceneDesc(0x13, 'Stadium'),
    new BARSceneDesc(0x14, 'Volcano'),
    new BARSceneDesc(0x15, 'Dunes'),
    new BARSceneDesc(0x16, 'Rooftops'),
    new BARSceneDesc(0x17, 'Ice Flows'),
    new BARSceneDesc(0x18, 'Parkade'),
    new BARSceneDesc(0x19, 'Woods'),
    new BARSceneDesc(0x1A, '[Unused] MULT 10'),
    'Other',
    // TODO: The commented out ones cause errors, need to figure out why
    //new BARSceneDesc(0x0, 'NONE'),
    //new BARSceneDesc(0x1, 'TEST ROAD'),
    new BARSceneDesc(0x2, 'TEST GRID'),
    new BARSceneDesc(0x3, 'CHECKER BOARD'),
    new BARSceneDesc(0x4, 'ROUND TRACK'),
    //new BARSceneDesc(0xF, 'DRAGSTRIP'),
    //new BARSceneDesc(0x10, 'DERBY'),
    new BARSceneDesc(0x21, 'FINISH'),
    'Menu backgrounds',
    new BARSceneDesc(null, 'unk[ asdasd]', 0x1),
    new BARSceneDesc(null, 'One Player[ asdasd]', 0x8),
    new BARSceneDesc(null, 'Championship/Difficulty[ asdasd]', 0x9),
    new BARSceneDesc(null, 'Main Menu[ asdasd]', 0xA),
    new BARSceneDesc(null, ' Single Race/Beetle Battle Select Players[ asdasd]', 0xB),

    'Intro level sections',
    new BARSceneDesc(0x1B, 'INTRO1'),
    new BARSceneDesc(0x1C, 'INTRO2'),
    new BARSceneDesc(0x1D, 'INTRO3'),
    new BARSceneDesc(0x1E, 'INTRO4'),
    new BARSceneDesc(0x1F, 'INTRO5'),
    new BARSceneDesc(0x20, 'INTRO6'),

    // TODO:
    /*
    1: Empty Mount Mayhem menu track
    2: Beetle Battle Car Color Select area
    3: Car Select area
    4: Intro track of Mount Mayhem (INTRO3)
    5: Intro track of Sunset Sands (INTRO4)
    6: Intro track of Inferno Isle (INTRO5)
    7: Intro track of Metro Madness (INTRO6)
    8: One Player menu track
    9: Championship/Difficulty menu track
    10: Main Menu menu track
    11: Single Race/Beetle Battle Select Players menu track
    12: DERBY
    13: CARS model viewer dragstrip
    14: DRAGSTRIP
    15: "Test turning track"
    18: TEST ROAD
    38: Intro track of Coventry Cove (INTRO1)
    39: Intro track of Wicked Woods (INTRO2)
    */


    //TODO?: There are other UVTRs that aren't part of a scene, are any of them interesting enough to include?

    // 'Not Sure',
    // new BARSceneDesc(0, '0'),
    // new BARSceneDesc(2, 'Parkade duplicate??'),
    // new BARSceneDesc(12, '12'),
    // new BARSceneDesc(13, '13'),
    // new BARSceneDesc(14, '14'),
    // new BARSceneDesc(15, '15'), // bridge test level
    // new BARSceneDesc(16, '16'), // big ring test level
    // new BARSceneDesc(17, '17'), // checkerboard test level
    // new BARSceneDesc(18, '18'),
    // new BARSceneDesc(37, '37'),
    // new BARSceneDesc(1, '1'), // blue tint
    // new BARSceneDesc(3, '3'), // blue tint
    // new BARSceneDesc(8, '8'), // blue tint
    // new BARSceneDesc(9, '9'), // blue tint
    // new BARSceneDesc(10, '10'), // blue tint
    // new BARSceneDesc(11, '11'), // blue tint

];

export const sceneGroup: SceneGroup = { id, name, sceneDescs };
