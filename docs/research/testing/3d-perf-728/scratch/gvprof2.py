import json,sys,re,collections
f=sys.argv[1]; p=json.load(open(f))
cats=[c['name'] for c in p['meta']['categories']]
best=None
for q in p['processes']:
    for t in q['threads']:
        if t['name']=='GeckoMain' and t['processType']=='tab':
            n=len(t['stackTable']['data'])
            if best is None or n>best[0]: best=(n,t)
t=best[1]
S=t['samples']['schema']; ST=t['stackTable']['schema']; FT=t['frameTable']['schema']
st=t['stackTable']['data']; fr=t['frameTable']['data']; strs=t['stringTable']
loc=lambda i: strs[fr[i][FT['location']]]
def frames(s):
    o=[]
    while s is not None: r=st[s]; o.append(r[ST['frame']]); s=r[ST['prefix']]
    return o
B=collections.Counter(); kids=collections.defaultdict(collections.Counter); selfin=collections.defaultdict(collections.Counter)
tot=0; idle=0; harness=0
T=[r[S['time']] for r in t['samples']['data']]
# per-sample time weight = dt to next sample (ms) so slow sampling is fair
data=t['samples']['data']
for k,r in enumerate(data):
    s=r[S['stack']]
    if s is None: continue
    w=(T[k+1]-T[k]) if k+1<len(T) else 1
    L=[loc(i) for i in frames(s)]
    j='\n'.join(L)
    if 'ProcessNextNativeEvent:Wait' in j: idle+=w; continue
    if 'MarionetteCommandsChild' in j or 'chrome://remote' in j: harness+=w; continue
    tot+=w
    if re.search(r'(^|\n)tc \(http[^\n]*useSceneActivity',j): b='地形 LOD 重建 buildAdaptiveTerrain(tc)'
    elif 'this.render' in j: b='three.js render (GL提交)'
    elif re.search(r'useSceneActivity-[^ ]*\.js',j) and re.search(r'(^|\n)bn \(',j): b='animate 其余(bn自身+各runtime)'
    elif 'main-DJxlTEel' in j or 'router-' in j or 'Replay3DPane' in j: b='Vue/应用 JS (main/router/pane chunk)'
    elif re.search(r'Paint|DisplayList|WebRender|nsLayoutUtils::PaintFrame',j): b='浏览器绘制/合成(Paint/DisplayList)'
    elif re.search(r'Reflow|Layout|Restyle|Styles|Flush',j): b='样式/布局'
    elif 'GC' in j or 'CC' in j and 'collect' in j.lower(): b='GC/CC'
    elif 'js::RunScript' in j or 'FrameRequestCallback' in j: b='其他 JS'
    else: b='其他原生/IPC'
    B[b]+=w
    # attribute inclusive to bucket fn names for the app chunks
    for l in set(L):
        if 'useSceneActivity' in l: kids[b][l]+=w
    lf=L[0]; selfin[b][lf]+=w
print(f'{f}: nonidle(excl.harness) {tot:.0f} ms  idle {idle:.0f} ms  harness {harness:.0f} ms  span {(T[-1]-T[0])/1000:.1f}s  busy%={100*tot/(tot+idle+harness):.1f}')
for b,v in B.most_common(): print('  %-34s %7.0f ms %5.1f%% of nonidle'%(b,v,100*v/tot))
if len(sys.argv)>2:
    for b in B:
        print('--',b)
        for l,v in kids[b].most_common(10): print('    incl %5.0f %s'%(v,l[:130]))
        for l,v in selfin[b].most_common(6): print('    self %5.0f %s'%(v,l[:130]))
