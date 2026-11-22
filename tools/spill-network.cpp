// Build a minimum spanning tree on sampled points of an adaptive bathymetry grid.
// Run through build-spills.py. Raw GMT elevation samples are in half meters.
#include <algorithm>
#include <cmath>
#include <cstdint>
#include <fstream>
#include <iostream>
#include <numeric>
#include <stdexcept>
#include <string>
#include <vector>

constexpr int W=7200, H=3600, S=5, F=12, COUNT=W*H, COARSE=COUNT/(S*S);
constexpr int16_t LAND=32767;
struct Patch { int x, y, w, h, start; };

template<class T> static void readRaster(const std::string &path,T *dst,size_t n) {
    std::ifstream in(path,std::ios::binary);
    if (!in.read(reinterpret_cast<char*>(dst),n*sizeof(T))) throw std::runtime_error(path);
}
template<class T> static void writeArray(std::ostream &out,const std::vector<T> &v) {
    out.write(reinterpret_cast<const char*>(v.data()),v.size()*sizeof(T));
}

int main(int argc,char** argv) {
    if (argc!=6) throw std::runtime_error("Usage: spill-network BASE PATCH_LIST SURVEY_LINKS ELEVATION_OUT TREE_OUT");
    std::vector<Patch> patches;
    std::vector<int16_t> z(COUNT);
    readRaster(argv[1],z.data(),COUNT);
    std::vector<int8_t> patchAt(COUNT,-1);
    std::ifstream specs(argv[2]);
    std::string path;
    int x,y,w,h;
    while (specs >> x >> y >> w >> h >> path) {
        Patch p{x,y,w,h,static_cast<int>(z.size())};
        for(int j=y;j<y+h;j++) for(int i=x;i<x+w;i++) {
            if(patchAt[j*W+i]>=0) throw std::runtime_error("Overlapping windows");
            patchAt[j*W+i]=patches.size();
        }
        z.resize(z.size()+w*h*F*F);
        readRaster(path,z.data()+p.start,w*h*F*F);
        patches.push_back(p);
    }
    for(auto &v:z) v=static_cast<int16_t>(std::round(v*0.5));
    for(int i=0;i<COUNT;i++) if(patchAt[i]>=0) z[i]=LAND;
    const int n=z.size();
    std::vector<int> dsu(n,-1), representative(n,-1), reference(COARSE), owner(COARSE);
    std::vector<uint8_t> rank(n);
    std::vector<int16_t> elevation(COARSE), sill(COARSE,LAND);
    auto coordinate = [&](int x,int y,int dx,int dy) {
        int index=y*W+x;
        if(patchAt[index]<0) return index;
        const auto &p=patches[patchAt[index]];
        return p.start+((y-p.y)*F+dy)*p.w*F+(x-p.x)*F+dx;
    };
    // Survey links constrain inter-basin flow where even the refined DEM
    // smooths away a narrow surveyed channel. No bed heights are modified.
    auto locate = [&](double lon, double lat) {
        const double col=(lon+180)*W/360.0,row=(90-lat)*H/180.0;
        const int x=std::floor(col), y=std::floor(row);
        return coordinate(x,y,std::floor((col-x)*F),std::floor((row-y)*F));
    };
    struct SurveyLink { int left,right,sill; };
    std::vector<SurveyLink> surveyed;
    std::ifstream measurements(argv[3]);
    double lon1,lat1,lon2,lat2;
    int surveyedSill;
    while(measurements >> lon1 >> lat1 >> lon2 >> lat2 >> surveyedSill) {
        SurveyLink link{locate(lon1,lat1),locate(lon2,lat2),surveyedSill};
        if(z[link.left]>surveyedSill || z[link.right]>surveyedSill)
            throw std::runtime_error("Survey link anchored in shallow water");
        surveyed.push_back(link);
    }
    for(int row=0,i=0;row<H/S;row++) for(int col=0;col<W/S;col++,i++) {
        const int point=coordinate(col*S+S/2,row*S+S/2,F/2,F/2);
        elevation[i]=z[point]; reference[i]=point; representative[point]=i;
    }
    std::ofstream bed(argv[4],std::ios::binary);
    writeArray(bed,elevation);
    // Counting sort makes processing ~30M grid points independent of elevation range.
    const int low=*std::min_element(z.begin(),z.end());
    std::vector<int> buckets(-low,0);
    for(auto v:z) if(v<0) buckets[v-low]++;
    std::vector<int> start(buckets.size()+1,0);
    std::partial_sum(buckets.begin(),buckets.end(),start.begin()+1);
    std::vector<int> next(start), sorted(start.back());
    for(int i=0;i<n;i++) if(z[i]<0) sorted[next[z[i]-low]++]=i;

    auto find = [&](int a) {
        int root=a;
        while(dsu[root]!=root) root=dsu[root];
        while(dsu[a]!=a) { int b=dsu[a]; dsu[a]=root; a=b; }
        return root;
    };
    int current=0,level=low;
    auto join = [&](int adjacent) {
        if(dsu[adjacent]<0) return;
        int a=find(current), b=find(adjacent);
        if(a==b) return;
        if(rank[a]<rank[b]) std::swap(a,b);
        dsu[b]=a;
        if(rank[a]==rank[b]) rank[a]++;
        int left=representative[a],right=representative[b];
        if(left<0) representative[a]=right;
        else if(right>=0) {
            // Suppress all the fine cells on this path and retain its highest saddle.
            owner[right]=left;
            sill[right]=level;
        }
    };
    for(int b=0;b<static_cast<int>(buckets.size());b++) {
        level=low+b;
        for(int k=start[b];k<start[b+1];k++) {
            current=sorted[k]; dsu[current]=current;
            if(current<COUNT) {
                const int cx=current%W, cy=current/W;
                auto neighbor=[&](int dx,int dy) {
                    int nx=(cx+dx+W)%W,ny=cy+dy;
                    if(ny<0||ny>=H) return;
                    int index=ny*W+nx;
                    if(patchAt[index]<0) join(index);
                    else for(int i=0;i<F;i++) {
                        join(coordinate(nx,ny,dx>0?0:(dx<0?F-1:i),dy>0?0:(dy<0?F-1:i)));
                    }
                };
                neighbor(-1,0); neighbor(1,0); neighbor(0,-1); neighbor(0,1);
            } else {
                const auto &p=*(std::upper_bound(patches.begin(),patches.end(),current,
                    [](int i,const Patch& window){return i<window.start;})-1);
                const int pw=p.w*F,ph=p.h*F;
                const int fx=(current-p.start)%pw, fy=(current-p.start)/pw;
                // Refined windows lie strictly inside the global domain and are disjoint.
                join(fx?current-1:(p.y+fy/F)*W+p.x-1);
                join(fx<pw-1?current+1:(p.y+fy/F)*W+p.x+p.w);
                join(fy?current-pw:(p.y-1)*W+p.x+fx/F);
                join(fy<ph-1?current+pw:(p.y+p.h)*W+p.x+fx/F);
            }
        }
        for(const auto &link:surveyed) if(link.sill==level) {
            current=link.left;
            join(link.right);
        }
    }
    const int pacific=coordinate(720,1800,0,0);
    const int oceanRoot=find(pacific),root=representative[oceanRoot];
    owner[root]=root;
    sill[root]=elevation[root];
    int oceanCells=0;
    for(int i=0;i<COARSE;i++) {
        int fine=reference[i];
        if(dsu[fine]<0 || find(fine)!=oceanRoot) {owner[i]=0;sill[i]=LAND;}
        else {owner[i]-=i;oceanCells++;}
    }
    // Planar integer arrays gzip well. Owners are relative pixel indices.
    std::ofstream out(argv[5],std::ios::binary);
    out.write("SPL1",4);
    writeArray(out,std::vector<int32_t>{W/S,H/S,root,oceanCells});
    writeArray(out,owner); writeArray(out,sill);
    if(!out||!bed) throw std::runtime_error("Could not write output");
    std::cerr<<"Fine cells: "<<n<<", ocean samples: "<<oceanCells<<", root: "<<root<<'\n';
}
