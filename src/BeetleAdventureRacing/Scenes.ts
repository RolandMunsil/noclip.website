import { mat4 } from "gl-matrix";
import { colorNewFromRGBA } from "../Color";
import { setAttachmentStateSimple } from "../gfx/helpers/GfxMegaStateDescriptorHelpers";
import { BasicRenderTarget, makeClearRenderPassDescriptor } from "../gfx/helpers/RenderTargetHelpers";
import { GfxBindingLayoutDescriptor, GfxBlendFactor, GfxBlendMode, GfxCullMode, GfxDevice, GfxHostAccessPass, GfxRenderPass } from "../gfx/platform/GfxPlatform";
import { executeOnPass } from "../gfx/render/GfxRenderer";
import { GfxRenderHelper } from "../gfx/render/GfxRenderGraph";
import { SceneContext, SceneDesc, SceneGroup } from "../SceneBase";
import { SceneGfx, ViewerRenderInput } from "../viewer";
import { Filesystem, loadFilesystem } from "./Filesystem";
import { UVTR, UVTRRenderer } from "./ParsedFiles/UVTR";
import { TempTestingProgram, MaterialRenderer } from "./MaterialRenderer";

const bindingLayouts: GfxBindingLayoutDescriptor[] = [
    { numUniformBuffers: 2, numSamplers: 1 },
];

class BARRenderer implements SceneGfx {

    public renderHelper: GfxRenderHelper;
    public program: TempTestingProgram;
    private renderTarget = new BasicRenderTarget();

    private uvtrRenderer: UVTRRenderer;

    constructor(device: GfxDevice, uvtr: UVTR) {
        this.renderHelper = new GfxRenderHelper(device);
        this.program = new TempTestingProgram();
        this.uvtrRenderer = new UVTRRenderer(uvtr, device);
    }

    // TODO-ASK: what is a render inst?
    public prepareToRender(device: GfxDevice, hostAccessPass: GfxHostAccessPass, viewerInput: ViewerRenderInput): void {
        const topTemplate = this.renderHelper.pushTemplateRenderInst();
        
        topTemplate.setBindingLayouts(bindingLayouts);

        topTemplate.setMegaStateFlags(setAttachmentStateSimple({}, {
            blendMode: GfxBlendMode.ADD,
            blendSrcFactor: GfxBlendFactor.SRC_ALPHA,
            blendDstFactor: GfxBlendFactor.ONE_MINUS_SRC_ALPHA,
        }));
        topTemplate.setMegaStateFlags({cullMode: GfxCullMode.BACK});

        // TODO-ASK
        const renderInstManager = this.renderHelper.renderInstManager;
        this.uvtrRenderer.prepareToRender(device, renderInstManager, viewerInput);

        this.renderHelper.renderInstManager.popTemplateRenderInst();       
        this.renderHelper.prepareToRender(device, hostAccessPass);
    }

    //TODO-ASK: how does this work? what is a pass? what is the host access pass? what is the return value?
    public render(device: GfxDevice, viewerInput: ViewerRenderInput): GfxRenderPass {
        const hostAccessPass = device.createHostAccessPass();
        this.prepareToRender(device, hostAccessPass, viewerInput);
        device.submitPass(hostAccessPass);

        const renderInstManager = this.renderHelper.renderInstManager;
        this.renderTarget.setParameters(device, viewerInput.backbufferWidth, viewerInput.backbufferHeight);

        const passRenderer = this.renderTarget.createRenderPass(device, viewerInput.viewport, makeClearRenderPassDescriptor(true, colorNewFromRGBA(0, 0, 0, 1)));
        executeOnPass(renderInstManager, device, passRenderer, 0);
        // executeOnPass(renderInstManager, device, passRenderer, PW64Pass.SNOW);

        renderInstManager.resetRenderInsts();
        return passRenderer;
    }

    public destroy(device: GfxDevice): void {
        this.renderHelper.destroy(device);
        this.renderTarget.destroy(device);
        this.uvtrRenderer.destroy(device);
    }
}

// TODO: move?
export const pathBase = `BeetleAdventureRacing`;
class BARSceneDesc implements SceneDesc {
    public id: string;
    constructor(public uvtrIndex: number, public name: string) {
        this.id = uvtrIndex.toString();
    }

    public async createScene(device: GfxDevice, context: SceneContext): Promise<SceneGfx> {
        const filesystem = await context.dataShare.ensureObject<Filesystem>(`${pathBase}/FilesystemData`, async () => {
            return await loadFilesystem(context.dataFetcher, device);
        });

        const uvtr = filesystem.getParsedFile(UVTR, "UVTR", this.uvtrIndex);
        console.log(uvtr);
        return new BARRenderer(device, uvtr);
    }
}

const id = 'BeetleAdventureRacing';
const name = "Beetle Adventure Racing!";
const sceneDescs = [
    'Tracks', // TODO: name?
    new BARSceneDesc(19, 'Coventry Cove'),
    new BARSceneDesc(34, 'Mount Mayhem'),
    new BARSceneDesc(22, 'Inferno Isle'),
    new BARSceneDesc(20, 'Sunset Sands'),
    new BARSceneDesc(21, '[thing under sunset sands]'),
    new BARSceneDesc(35, 'Metro Madness'),
    new BARSceneDesc(23, 'Wicked Woods'),
    'Beetle Battle',
    new BARSceneDesc(24, 'Airport'),
    new BARSceneDesc(26, 'Castle'),
    new BARSceneDesc(27, 'Stadium'),
    new BARSceneDesc(28, 'Volcano'),
    new BARSceneDesc(29, 'Dunes'),
    new BARSceneDesc(30, 'Rooftops'),
    new BARSceneDesc(31, 'Ice Flows'),
    new BARSceneDesc(32, 'Parkade'),
    new BARSceneDesc(33, 'Woods'),
    'Unused',
    new BARSceneDesc(36, 'Stunt O\'Rama'), // Stunt O Rama (unused)
    new BARSceneDesc(25, 'Unused Beetle Battle arena'),
    'Not Sure',
    new BARSceneDesc(0, '0'),
    new BARSceneDesc(2, 'Parkade duplicate??'),
    new BARSceneDesc(12, '12'),
    new BARSceneDesc(13, '13'),
    new BARSceneDesc(14, '14'),
    new BARSceneDesc(15, '15'), // bridge test level
    new BARSceneDesc(16, '16'), // big ring test level
    new BARSceneDesc(17, '17'), // checkerboard test level
    new BARSceneDesc(18, '18'),
    new BARSceneDesc(37, '37'),
    //new BARSceneDesc(1, '1'), blue tint
    //new BARSceneDesc(3, '3'), blue tint
    // new BARSceneDesc(8, '8'), blue tint
    // new BARSceneDesc(9, '9'), blue tint
    // new BARSceneDesc(10, '10'), blue tint
    // new BARSceneDesc(11, '11'), blue tint
    // new BARSceneDesc(4, '4'), advertise segment
    // new BARSceneDesc(5, '5'), advertise segment
    // new BARSceneDesc(6, '6'), advertise segment
    // new BARSceneDesc(7, '7'), advertise segment
    // new BARSceneDesc(38, '38'), advertise segment
    // new BARSceneDesc(39, '39'), advertise segment

];

export const sceneGroup: SceneGroup = { id, name, sceneDescs };
