import sys, pyarrow.fs as fs, pyarrow.parquet as pq, pyarrow as pa, pyarrow.compute as pc, time, json
from concurrent.futures import ThreadPoolExecutor
REL="2026-09-23.1"
s3=fs.S3FileSystem(anonymous=True, region="us-west-2", proxy_options=__import__("os").environ.get("HTTPS_PROXY"))
def fetch(theme, typ, bbox, out, cols=None):
    xmin,ymin,xmax,ymax=bbox
    base=f"overturemaps-us-west-2/release/{REL}/theme={theme}/type={typ}/"
    files=[f.path for f in s3.get_file_info(fs.FileSelector(base)) if f.path.endswith(".parquet") or "part-" in f.path]
    t=time.time()
    def hits(path):
        pf=pq.ParquetFile(path, filesystem=s3)
        md=pf.metadata; names=[md.schema.column(i).path for i in range(md.num_columns)]
        idx={n:names.index(n) for n in ["bbox.xmin","bbox.xmax","bbox.ymin","bbox.ymax"]}
        rgs=[]
        for r in range(md.num_row_groups):
            rg=md.row_group(r); st={k:rg.column(i).statistics for k,i in idx.items()}
            if st["bbox.xmin"].min<=xmax and st["bbox.xmax"].max>=xmin and st["bbox.ymin"].min<=ymax and st["bbox.ymax"].max>=ymin:
                rgs.append(r)
        return path,rgs,md.num_row_groups
    with ThreadPoolExecutor(16) as ex: res=list(ex.map(hits,files))
    tabs=[]
    for path,rgs,n in res:
        if not rgs: continue
        pf=pq.ParquetFile(path, filesystem=s3)
        tb=pf.read_row_groups(rgs, columns=cols)
        b=tb.column("bbox")
        m=pc.and_(pc.and_(pc.less_equal(pc.struct_field(b,"xmin"),xmax),pc.greater_equal(pc.struct_field(b,"xmax"),xmin)),pc.and_(pc.less_equal(pc.struct_field(b,"ymin"),ymax),pc.greater_equal(pc.struct_field(b,"ymax"),ymin)))
        tabs.append(tb.filter(m))
    tb=pa.concat_tables(tabs) if tabs else None
    if tb is not None: pq.write_table(tb,out,compression="zstd")
    print(theme,typ,len(files),"files", sum(len(r) for _,r,_ in res),"rowgroups read", 0 if tb is None else tb.num_rows,"rows", round(time.time()-t,1),"s", file=sys.stderr)
    return tb
if __name__=="__main__":
    theme,typ,bb,out=sys.argv[1],sys.argv[2],sys.argv[3],sys.argv[4]
    fetch(theme,typ,[float(x) for x in bb.split(",")],out)
