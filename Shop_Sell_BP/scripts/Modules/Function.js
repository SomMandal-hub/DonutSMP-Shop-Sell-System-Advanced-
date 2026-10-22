import { Player, Entity, world, ScoreboardIdentityType, ScoreboardIdentity, ScoreboardObjective, system } from "@minecraft/server";
import { FormCancelationReason } from "@minecraft/server-ui";

export function getScore(entity, objective) {
  try {
    return world.scoreboard
      .getObjective(objective)
      .getScore(entity.scoreboardIdentity);
  } catch (error) {
    return 0;
  }
}

export function getRandomChatColor() {
    const colors = ["§1", "§2", "§3", "§4", "§5", "§6", "§9", "§a", "§b", "§c", "§d", "§e", "§f"];
    return colors[Math.floor(Math.random() * colors.length)];
}

export function loadStructure(player, id, slots = 0) {
    const slot = slots;
    
    // Vị trí load structure mới: X của người chơi, Y cố định là -64, Z của người chơi
    const loadY = -64; 
    
    // Tải Structure tại vị trí X hiện tại, Y = -64, Z hiện tại
    const location = player.location;
    // Sử dụng runCommand với location chính xác để load tại vị trí X ~ Y=-64 Z ~
    player.runCommand(`structure load ${id} ${location.x} ${loadY} ${location.z}`);
    
    // Lấy Block rương đã load.
    // Giả định structure được lưu là một cái rương duy nhất (hoặc block chứa item là block (0, -64, 0) tương đối so với người chơi)
    // Cần chuyển đổi vị trí đã load thành BlockLocation chính xác (x, loadY, z)
    const blockLocation = {
        x: Math.floor(location.x), 
        y: Math.floor(loadY), // Y cố định là -64
        z: Math.floor(location.z)
    };
    
    // Lấy block tại vị trí Structure được load (chính là block rương)
    const block = player.dimension.getBlock(blockLocation); 
    if (!block) return;
    
    // Giả định block đầu tiên của structure là một container (như Chest)
    const invComp = block.getComponent("inventory");
    if (!invComp) return;
    
    const inv = invComp.container;
    const item = inv.getItem(slot);
    
    if (item) {
        const playerInv = player.getComponent("inventory").container;
        playerInv.addItem(item);
        
        // **LOGIC MỚI BẮT ĐẦU TỪ ĐÂY**
        // Xóa item đã lấy khỏi slot
        inv.setItem(slot, undefined); 
    }
    
    // **Thêm bước Clear toàn bộ Container**
    // Nếu bạn chỉ muốn lấy 1 item (hoặc một vài item) và phá rương, 
    // bạn cần đảm bảo rương trống hoàn toàn trước khi setType("minecraft:air").
    
    // Lặp qua tất cả các slot và xóa item để đảm bảo không có gì bị rơi ra.
    for (let i = 0; i < inv.size; i++) {
        // Chỉ xóa slot nếu chưa bị xóa ở bước trên
        if (inv.getItem(i)) {
            inv.setItem(i, undefined);
        }
    }
    // **LOGIC MỚI KẾT THÚC**

    block.setType("minecraft:air"); 
}



export function metricNumbers(value) {
  const types = ["", "§dk", "§dM", "§dB", "§dT", "§dP", "§dE", "§dZ", "§dY"];
  const selectType = (Math.log10(value) / 3) | 0;
  
  if (selectType == 0) return value;
  
  let scaled = value / Math.pow(10, selectType * 3);
  return scaled.toFixed(1) + types[selectType];
}

export function pickRandom(warray) {
  var randomNumber = Math.floor(Math.random() * warray.length);
  return warray[randomNumber];
}

export function random(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

export function setTickTimeout(callback, tick) {
  let ticks = 0;
  let TickCallBack = world.events.tick.subscribe(() => {
    ticks += 1;
    if (ticks == tick) {
      callback();
      world.events.tick.unsubscribe(TickCallBack);
    }
  });
}

export function removeNonNumeric(str) {
  return str.replace(/[^0-9]/g, '');
}

export function removeNonAlphabet(str) {
  return str.replace(/[^a-zA-Z]/g, '');
}

export function timeToMiliSecond(value) {
  let p = removeNonNumeric(value);
  let o;
  let b = removeNonAlphabet(value);
  
  if (b.length !== 1) return undefined;
  
  if (value.includes("s")) {
    o = p * 1000;
  } else if (value.includes("m")) {
    o = p * 60000;
  } else if (value.includes("h")) {
    o = p * 3600000;
  }
  
  return o;
}

export function clockString(ms, mode = '') {
  if (mode === '') {
    const modes = ['1', '2'];
    mode = modes[Math.floor(Math.random() * modes.length)];
  }

  switch (mode) {
    case '1':
      return formatMode1(ms);
    case '2':
      return formatMode2(ms);
    default:
      return 'Invalid mode';
  }
}

function formatMode1(ms) {
  const h = Math.floor(ms / 3600000);
  const m = Math.floor(ms / 60000) % 60;
  const s = Math.floor(ms / 1000) % 60;
  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}


function formatMode2(ms) {
  const h = Math.floor(ms / 3600000);
  const m = Math.floor(ms / 60000) % 60;
  const s = Math.floor(ms / 1000) % 60;

  const parts = [];
  if (h > 0) parts.push(`${h} hour${h > 1 ? 's' : ''}`);
  if (m > 0) parts.push(`${m} minute${m > 1 ? 's' : ''}`);
  if (s > 0) parts.push(`${s} second${s > 1 ? 's' : ''}`);

  return parts.join(' ');
}

export async function forceShow(player, form, timeout = Infinity) {
    const startTick = system.currentTick;
    while ((system.currentTick - startTick) < timeout) {
        const response = await form.show(player);
        if (response.cancelationReason !== FormCancelationReason.UserBusy) {
            return response;
        };
    };
    throw new Error(`Timed out after ${timeout} ticks`);
};
