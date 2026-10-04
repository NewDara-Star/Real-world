import duckdb, shapely, numpy as np, rasterio, math, gzip, json, mapbox_earcut as earcut
from rasterio.warp import transform
from shapely.ops import transform as stx
D="/home/user/Real-world/research/data/"
W,S,E,N=3.3730,6.5050,3.3820,6.5140
c=duckdb.connect()
rows=c.sql(f"select geometry, height, num_floors, sources[1].dataset ds from '{D}yaba_overture_buildings.parquet' where (bbox.xmin+bbox.xmax)/2 between {W} and {E} and (bbox.ymin+bbox.ymax)/2 between {S} and {N}").fetchall()
ras=rasterio.open(D+"yaba_google_temporal_2023_1km.tif"); H=ras.read(1)/2.0; P=ras.read(2)/100.0  # uint8-packed sample (see research doc)
lat0=(S+N)/2; kx=111320*math.cos(math.radians(lat0)); ky=110574
pos=[];idx=[];heights=[];nverts=0;ntri=0;src={}
for g,h,nf,ds in rows:
    poly=shapely.from_wkb(g)
    polys=list(poly.geoms) if poly.geom_type=="MultiPolygon" else [poly]
    # sample raster at centroid neighborhood
    cen=poly.centroid
    xs,ys=transform("EPSG:4326",ras.crs,[cen.x],[cen.y]); r,cc=ras.index(xs[0],ys[0])
    hh=None
    if h: hh=h
    elif nf: hh=nf*3.2
    elif 0<=r<H.shape[0] and 0<=cc<H.shape[1]:
        win=H[max(0,r-8):r+9,max(0,cc-8):cc+9]; pw=P[max(0,r-8):r+9,max(0,cc-8):cc+9]
        v=win[(pw>0.3)&(win>0)]
        if v.size: hh=float(np.median(v))
    if hh is None: hh=3.5; src['fallback_height']=src.get('fallback_height',0)+1
    heights.append(hh); src[ds]=src.get(ds,0)+1
    for p in polys:
        p=shapely.simplify(p,0.000004)  # ~0.4 m
        if p.is_empty: continue
        ring=np.array(p.exterior.coords)[:-1]
        if len(ring)<3: continue
        loc=np.c_[(ring[:,0]-W)*kx,(ring[:,1]-S)*ky]
        n=len(loc)
        # walls: duplicate verts per wall quad for flat normals (4 verts, 2 tris per edge)
        for i in range(n):
            a,b=loc[i],loc[(i+1)%n]
            base=nverts
            pos += [[a[0],0,a[1]],[b[0],0,b[1]],[b[0],hh,b[1]],[a[0],hh,a[1]]]
            idx += [base,base+1,base+2,base,base+2,base+3]; nverts+=4; ntri+=2
        tri=earcut.triangulate_float64(loc,np.array([n],dtype=np.uint32))
        base=nverts
        pos += [[x,hh,y] for x,y in loc]; nverts+=n
        idx += list(base+tri); ntri+=len(tri)//3
pos=np.array(pos,dtype=np.float32); idx=np.array(idx,dtype=np.uint32)
raw=pos.tobytes()+idx.tobytes()
q=np.round(pos*10).astype(np.int16)  # 10cm quantization, 1km tile fits int16
qraw=q.tobytes()+(idx.astype(np.uint16).tobytes() if nverts<65536 else idx.tobytes())
res={"cell":"~1.0 x 1.0 km around Yaba/Tejuosho (3.3730-3.3820E, 6.5050-6.5140N)","buildings":len(rows),"by_source":src,
 "height_median_m":float(np.median(heights)),"height_p90_m":float(np.percentile(heights,90)),
 "vertices":int(nverts),"triangles":int(ntri),"float32_raw_bytes":len(raw),"float32_gzip_bytes":len(gzip.compress(raw,9)),
 "int16_quantized_raw_bytes":len(qraw),"int16_quantized_gzip_bytes":len(gzip.compress(qraw,9))}
print(json.dumps(res,indent=1)); json.dump(res,open(D+"yaba_1km_extrusion_budget.json","w"),indent=1)
np.save("pos.npy",pos); np.save("idx.npy",idx)
fb=sum(1 for _ in [])
