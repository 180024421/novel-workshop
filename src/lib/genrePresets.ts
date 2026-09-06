/** 题材预设：建书 / 想法页可套用到 style.md 与总纲提示 */

export type GenrePreset = {
  id: string;
  label: string;
  style: string;
  outlineHint: string;
};

export const GENRE_PRESETS: GenrePreset[] = [
  {
    id: "通用",
    label: "通用",
    style: "- 对白自然，有画面与节奏\n- 禁止流水账与口号腔\n- 人物声口要区分\n",
    outlineHint: "节奏张弛有度，章末有钩子。",
  },
  {
    id: "玄幻",
    label: "玄幻",
    style:
      "- 升级/对决有画面与代价，忌无脑碾压堆砌\n- 功法/境界名词前后一致\n- 配角有立场，反派有智商\n- 禁止口号腔与流水账\n",
    outlineHint: "前期建立金手指与危机，中期升级打脸，章末留悬念。",
  },
  {
    id: "都市",
    label: "都市",
    style:
      "- 场景贴近日常，对白口语化\n- 职场/情感冲突具体可感\n- 少用夸张网文套话\n- 人物声口区分明显\n",
    outlineHint: "冲突落地到具体事件，避免空喊鸡血。",
  },
  {
    id: "历史",
    label: "历史",
    style:
      "- 称谓、官职、物资符合时代感（可适度戏说但勿现代梗）\n- 战争/权谋写因果与代价\n- 禁止现代网络用语入正文\n",
    outlineHint: "重大节点有历史张力，章与章推进清晰。",
  },
  {
    id: "科幻",
    label: "科幻",
    style:
      "- 科技设定前后自洽，少硬科堆砌术语\n- 用人物处境体现设定\n- 对白自然，忌说明书腔\n",
    outlineHint: "设定服务情节，每章有可感知的新信息或冲突。",
  },
  {
    id: "悬疑",
    label: "悬疑",
    style:
      "- 线索埋设与回收要干净\n- 信息差制造张力，忌无意义误导\n- 气氛靠细节，少空洞形容词\n",
    outlineHint: "每章至少推进一条线索或反转，章末留疑问。",
  },
  {
    id: "言情",
    label: "言情",
    style:
      "- 情感推进靠互动与选择，忌纯内心独白灌水\n- 配角不抢戏但有功能\n- 甜虐节奏交替\n",
    outlineHint: "关系阶段清晰，每章有情感推进或误会/和解节点。",
  },
  {
    id: "爽文",
    label: "爽文",
    style:
      "- 压抑→爆发节奏明确，打脸要有铺垫\n- 爽点具体（名场面），忌空喊\n- 配角反应到位衬托主角\n",
    outlineHint: "前抑后扬，每 2～3 章至少一个小高潮。",
  },
];

export function genrePresetById(id: string): GenrePreset {
  return GENRE_PRESETS.find((g) => g.id === id) || GENRE_PRESETS[0];
}

export const GENRE_LABELS = GENRE_PRESETS.map((g) => g.label);
