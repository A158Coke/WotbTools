from pathlib import Path
import cv2
import numpy as np

MAP_DIR=Path('frontend/src/assets/maps')
TMP=Path('/tmp/pr231-assets')
AUTH={'canal','desert-sands','oasis-palms','winter-malinovka'}
# Exact logical-pixel centers visually/QC calibrated against current branch images.
BASES={
'black-goldville':[(283,291),(479,466),(631,647)],'canyon':[(627,143),(323,369),(176,568)],
'castilla':[(105,391),(436,389),(623,388)],'copperfield':[(376,225),(380,410),(377,537)],
'dead-rail':[(106,386),(375,385),(661,424)],'falls-creek':[(151,383),(389,394),(607,395)],
'faust':[(377,157),(389,361),(581,387),(158,592)],'fort-despair':[(159,159),(325,334),(502,526)],
'ghost-factory':[(151,241),(488,362),(364,506),(619,585)],'hellas':[(295,175),(178,304),(543,543)],
'himmelsdorf':[(146,375),(405,299),(303,497),(531,401)],'horrorstadt':[(243,191),(407,411),(646,646)],
'lagoon':[(196,195),(393,392),(626,626)],'mayan-ruins':[(184,188),(419,417),(631,646)],
'middleburg':[(187,290),(277,476),(518,403)],'molendijk':[(172,208),(422,401),(595,583)],
'naval-frontier':[(263,268),(325,333),(466,484)],'new-bay':[(559,194),(332,417),(147,477),(385,621)],
'normandy':[(170,370),(374,370),(567,305),(566,437)],'port-bay':[(233,513),(351,377),(527,227)],
'rockfield':[(496,247),(329,434),(215,543)],'vineyards':[(404,229),(309,435),(592,596)],
'yamato-harbor':[(131,391),(340,391),(661,391)],'yukon':[(557,157),(277,227),(475,358),(213,490)]}
AUTH_TARGET={'winter-malinovka':(3016,3048),'desert-sands':(3060,3088),'canal':(3112,3088),'oasis-palms':(3048,3064)}

def spawn_boxes(im):
    hsv=cv2.cvtColor(im,cv2.COLOR_BGR2HSV); H,S,V=cv2.split(hsv)
    masks=[((H<10)|(H>170))&(S>150)&(V>145),(H>35)&(H<90)&(S>145)&(V>145)]
    out=[]
    for mask in masks:
        m=mask.astype(np.uint8)*255; m=cv2.morphologyEx(m,cv2.MORPH_CLOSE,np.ones((3,3),np.uint8))
        n,lab,stats,_=cv2.connectedComponentsWithStats(m,8)
        for i in range(1,n):
            x,y,w,h,a=stats[i]
            if 24<=w<=110 and 24<=h<=110 and .55<=w/h<=1.8 and a>=180: out.append((int(x),int(y),int(w),int(h),int(a)))
    keep=[]
    for b in sorted(out,key=lambda z:z[4],reverse=True):
        x,y,w,h,a=b; cx=x+w/2; cy=y+h/2
        if any((cx-(q[0]+q[2]/2))**2+(cy-(q[1]+q[3]/2))**2 < (max(w,h)*.55)**2 for q in keep): continue
        keep.append(b)
    return keep

def find_grid(gray):
    H,W=gray.shape; g=gray.astype(np.float32); xs=[];ys=[]
    for i in range(1,6):
        ex=W*i/6; vals=[]
        for x in range(max(4,int(ex-8)),min(W-4,int(ex+9))):
            local=(g[:,x-3]+g[:,x+3])/2; vals.append((float(np.mean(np.abs(g[:,x]-local)))+max(0,float(np.mean(local-g[:,x]))),x))
        xs.append(max(vals)[1]); ey=H*i/6;vals=[]
        for y in range(max(4,int(ey-8)),min(H-4,int(ey+9))):
            local=(g[y-3,:]+g[y+3,:])/2; vals.append((float(np.mean(np.abs(g[y,:]-local)))+max(0,float(np.mean(local-g[y,:]))),y))
        ys.append(max(vals)[1])
    return xs,ys

def interp_v(img,x):
    H,W=img.shape[:2];x0=max(0,x-3);x1=min(W-1,x+3);l=img[:,x0].astype(np.float32);r=img[:,x1].astype(np.float32)
    for xx in range(max(0,x-1),min(W,x+2)):
        a=(xx-x0)/(x1-x0);img[:,xx]=np.clip(l*(1-a)+r*a,0,255).astype(np.uint8)

def interp_h(img,y):
    H,W=img.shape[:2];y0=max(0,y-3);y1=min(H-1,y+3);t=img[y0].astype(np.float32);b=img[y1].astype(np.float32)
    for yy in range(max(0,y-1),min(H,y+2)):
        a=(yy-y0)/(y1-y0);img[yy]=np.clip(t*(1-a)+b*a,0,255).astype(np.uint8)

def patch_replace(dst,region,forbidden,rad=250,margin=10):
    H,W=dst.shape[:2];ys,xs=np.where(region>0)
    rx0,rx1,ry0,ry1=int(xs.min()),int(xs.max()),int(ys.min()),int(ys.max());x0=max(0,rx0-margin);y0=max(0,ry0-margin);x1=min(W,rx1+margin+1);y1=min(H,ry1+margin+1);mh,mw=y1-y0,x1-x0
    lm=region[y0:y1,x0:x1]; ring=cv2.subtract(cv2.dilate(lm,np.ones((11,11),np.uint8)),lm); gray=cv2.cvtColor(dst,cv2.COLOR_BGR2GRAY);target=gray[y0:y1,x0:x1]
    for rr in (rad,max(H,W)):
        sx0=max(0,x0-rr);sy0=max(0,y0-rr);sx1=min(W,x1+rr);sy1=min(H,y1+rr);search=gray[sy0:sy1,sx0:sx1]
        try: res=cv2.matchTemplate(search,target,cv2.TM_SQDIFF_NORMED,mask=ring)
        except cv2.error: res=cv2.matchTemplate(search,target,cv2.TM_SQDIFF_NORMED)
        res=np.where(np.isfinite(res),res,np.inf);bad=(forbidden[sy0:sy1,sx0:sx1]>0).astype(np.uint8);integ=cv2.integral(bad);oh,ow=res.shape;yy=np.arange(oh)[:,None];xx=np.arange(ow)[None,:];s=integ[yy+mh,xx+mw]-integ[yy,xx+mw]-integ[yy+mh,xx]+integ[yy,xx];res[s>0]=np.inf;tx=x0-sx0;ty=y0-sy0;res[max(0,ty-mh):min(oh,ty+mh+1),max(0,tx-mw):min(ow,tx+mw+1)]=np.inf
        if np.isfinite(res).any():
            by,bx=np.unravel_index(np.argmin(res),res.shape);src=dst[sy0+by:sy0+by+mh,sx0+bx:sx0+bx+mw].copy();return cv2.seamlessClone(src,dst,lm,(x0+mw//2,y0+mh//2),cv2.NORMAL_CLONE)
    return dst

def clean_old(name):
    p=MAP_DIR/(name+'.png');full=cv2.imread(str(p));Hf,Wf=full.shape[:2];W,H=round(Wf/4),round(Hf/4);orig=cv2.resize(full,(W,H),interpolation=cv2.INTER_LANCZOS4);work=orig.copy();combined=np.zeros((H,W),np.uint8)
    sp=[]
    for x,y,w,h,a in spawn_boxes(orig):
        m=np.zeros((H,W),np.uint8);cv2.rectangle(m,(max(0,x-5),max(0,y-5)),(min(W-1,x+w+4),min(H-1,y+h+4)),255,-1);sp.append(m);combined=cv2.bitwise_or(combined,m)
    bm=[];br=round(min(H,W)*.055)
    for cx,cy in BASES[name]:
        m=np.zeros((H,W),np.uint8);cv2.circle(m,(cx,cy),br,255,-1);bm.append(m);combined=cv2.bitwise_or(combined,m)
    labels=[]
    for i in range(6):
        cx=round(W*(i+.5)/6);cy=round(H*.022);lw=max(12,round(W*.03));lh=max(10,round(H*.026));m=np.zeros((H,W),np.uint8);cv2.rectangle(m,(cx-lw//2,max(0,cy-lh//2)),(cx+lw//2,min(H-1,cy+lh//2)),255,-1);labels.append(m);combined=cv2.bitwise_or(combined,m)
        cx=round(W*.018);cy=round(H*(i+.5)/6);lw=max(10,round(W*.025));lh=max(12,round(H*.03));m=np.zeros((H,W),np.uint8);cv2.rectangle(m,(max(0,cx-lw//2),cy-lh//2),(min(W-1,cx+lw//2),cy+lh//2),255,-1);labels.append(m);combined=cv2.bitwise_or(combined,m)
    su=np.zeros((H,W),np.uint8)
    for m in sp:su=cv2.bitwise_or(su,m)
    hsv=cv2.cvtColor(orig,cv2.COLOR_BGR2HSV);hh,s,v=cv2.split(hsv);red=(((hh<13)|(hh>167))&(s>105)&(v>95)).astype(np.uint8)*255;red[su>0]=0
    rb=np.zeros_like(red)
    if name=='naval-frontier':
        bx=round(W*.28);by=round(H*.28);border=np.zeros_like(red);border[:by]=255;border[-by:]=255;border[:,:bx]=255;border[:,-bx:]=255;rb=cv2.bitwise_and(red,border);rb=cv2.dilate(rb,np.ones((3,3),np.uint8))
    xs,ys=find_grid(cv2.cvtColor(orig,cv2.COLOR_BGR2GRAY));grid=np.zeros((H,W),np.uint8)
    for x in xs:cv2.rectangle(grid,(x-2,0),(x+2,H-1),255,-1);interp_v(work,x)
    for y in ys:cv2.rectangle(grid,(0,y-2),(W-1,y+2),255,-1);interp_h(work,y)
    combined=cv2.bitwise_or(combined,grid);combined=cv2.bitwise_or(combined,rb);forbid=np.zeros((H,W),np.uint8)
    for m in sp+bm+labels:forbid=cv2.bitwise_or(forbid,m)
    for m in bm+sp:work=patch_replace(work,m,forbid)
    small=rb.copy()
    for m in labels:small=cv2.bitwise_or(small,m)
    if small.any():work=cv2.inpaint(work,small,3,cv2.INPAINT_TELEA)
    up=cv2.resize(work,(Wf,Hf),interpolation=cv2.INTER_LANCZOS4);mu=cv2.resize(combined,(Wf,Hf),interpolation=cv2.INTER_NEAREST);mu=cv2.dilate(mu,np.ones((5,5),np.uint8));a=(cv2.GaussianBlur(mu,(0,0),1.2)/255.)[...,None];out=np.clip(up*a+full*(1-a),0,255).astype(np.uint8);cv2.imwrite(str(p),out,[cv2.IMWRITE_PNG_COMPRESSION,4])

def clean_authoritative(name):
    src=cv2.imread(str(TMP/(name+'.webp')),cv2.IMREAD_COLOR);ov=cv2.imread(str(TMP/(name+'-overlay.webp')),cv2.IMREAD_UNCHANGED)
    if src is None or ov is None:raise RuntimeError('missing authoritative temp input '+name)
    if ov.shape[:2]!=src.shape[:2]:ov=cv2.resize(ov,(src.shape[1],src.shape[0]),interpolation=cv2.INTER_LANCZOS4)
    if ov.shape[2]!=4:raise RuntimeError('overlay missing alpha '+name)
    alpha=ov[:,:,3:4].astype(np.float32)/255.;out=np.clip(ov[:,:,:3].astype(np.float32)*alpha+src.astype(np.float32)*(1-alpha),0,255).astype(np.uint8)
    tw,th=AUTH_TARGET[name];out=cv2.resize(out,(tw,th),interpolation=cv2.INTER_LANCZOS4);blur=cv2.GaussianBlur(out,(0,0),.75);out=cv2.addWeighted(out,1.10,blur,-.10,0);cv2.imwrite(str(MAP_DIR/(name+'.png')),out,[cv2.IMWRITE_PNG_COMPRESSION,4])

def main():
    for name in BASES: print('clean',name,flush=True);clean_old(name)
    expected={p.stem:p for p in MAP_DIR.glob('*.png')}
    if len(expected)!=28:raise RuntimeError(f'expected 28 map pngs, got {len(expected)}')
if __name__=='__main__':main()
