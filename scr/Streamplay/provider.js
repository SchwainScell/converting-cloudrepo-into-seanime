/// <reference path="./online-streaming-provider.d.ts" />

class Provider {
  constructor() {
    this.base = "https://tv12.idlixku.com";
    this.playerBase = "https://jeniusplay.com";
    this.headers = {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36",
      "Accept-Language": "en-US,en;q=0.9,id;q=0.8",
      "Referer": this.base + "/",
    };
  }

  getSettings() {
    return {
      episodeServers: ["JeniusPlay"],
      supportsDub: false,
    };
  }

  async search(query) {
    // Idlix uses standard WordPress search querying
    const searchUrl = `${this.base}/?s=${encodeURIComponent(query.query)}`;
    const res = await fetch(searchUrl, { headers: this.headers });
    const html = await res.text();

    const results = [];
    // Basic Regex to parse the WordPress search results grid
    const regex = /<article.*?href=["'](.*?)["'].*?img src=["'](.*?)["'].*?alt=["'](.*?)["']/gi;
    let match;

    while ((match = regex.exec(html)) !== null) {
      results.push({
        id: match[1], // We use the direct URL as the ID
        title: match[3],
        url: match[1],
        subOrDub: "sub",
        cover: match[2],
      });
    }

    if (!results.length) throw new Error("No movies/anime found");
    return results;
  }

  async findEpisodes(id) {
    // id is the full URL of the movie page
    const res = await fetch(id, { headers: this.headers });
    const html = await res.text();

    // Extract the WordPress Post ID needed for the player
    const postIdMatch = html.match(/id=["']dooplay-ajax-counter["']\s+data-postid=["'](\d+)["']/i);
    if (!postIdMatch) throw new Error("Could not extract Post ID for player");

    const postId = postIdMatch[1];

    // For movies, we just return one episode containing the Post ID
    return [{
      id: postId,
      title: "Full Movie",
      number: 1,
      url: id,
    }];
  }

  async findEpisodeServer(episode, server) {
    const postId = episode.id;

    // 1. Fetch Embed Hash from WordPress AJAX
    const ajaxFormData = new URLSearchParams();
    ajaxFormData.append("action", "doo_player_ajax");
    ajaxFormData.append("post", postId);
    ajaxFormData.append("nume", "1");
    ajaxFormData.append("type", "movie");

    const ajaxRes = await fetch(`${this.base}/wp-admin/admin-ajax.php`, {
      method: "POST",
      headers: { ...this.headers, "Content-Type": "application/x-www-form-urlencoded" },
      body: ajaxFormData.toString()
    });
    
    const ajaxData = await ajaxRes.json();
    let embedHash = ajaxData.embed_url; 
    
    // NOTE: If ajaxData.embed_url is AES encrypted (as shown in the Python script), 
    // it must be decrypted here before proceeding.
    
    // Clean up embed URL to get just the hash/ID
    if (embedHash && embedHash.includes("/video/")) {
      embedHash = embedHash.split("/video/")[1].split("?")[0];
    } else if (embedHash && embedHash.includes("=")) {
      embedHash = embedHash.split("=")[1];
    }

    // 2. Fetch M3U8 and Subtitles from JeniusPlay
    const playerFormData = new URLSearchParams();
    playerFormData.append("hash", embedHash);
    playerFormData.append("r", this.base);

    const playerRes = await fetch(`${this.playerBase}/player/index.php?data=${embedHash}&do=getVideo`, {
      method: "POST",
      headers: {
        "Host": "jeniusplay.com",
        "X-Requested-With": "XMLHttpRequest",
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
        "Referer": this.base + "/",
      },
      body: playerFormData.toString()
    });

    const playerText = await playerRes.text();
    let videoUrl = "";
    
    try {
      const playerData = JSON.parse(playerText);
      if (playerData.videoSource) {
        // Force .m3u8 extension as per python script logic
        videoUrl = playerData.videoSource.replace(/\.[^/.]+$/, "") + ".m3u8"; 
      }
    } catch(e) {
      throw new Error("Failed to parse JeniusPlay response");
    }

    if (!videoUrl) throw new Error("Stream URL not found");

    // 3. Extract Subtitles using Regex
    const subtitles = [];
    const subMatch = playerText.match(/var\s+playerjsSubtitle\s*=\s*["'](.*?)["']/i);
    if (subMatch && subMatch[1]) {
        // Ensure standard URL format
        let subUrl = subMatch[1];
        if (subUrl.includes("https://")) {
            subUrl = "https://" + subUrl.split("https://")[1];
        }
        
        subtitles.push({
            id: "1",
            url: subUrl,
            language: "id", // Assuming Indonesian based on the site
            isDefault: true,
        });
    }

    return {
      server: "JeniusPlay",
      videoSources: [{
        url: videoUrl,
        quality: "auto",
        type: "hls",
        subtitles: subtitles,
      }],
    };
  }
}
