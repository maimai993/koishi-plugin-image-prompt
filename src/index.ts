import { Context, Schema, h, Logger, sleep, Session } from 'koishi'

export const name = 'image-prompt'
export const inject = ['http', 'logger', 'i18n']

export const usage = `
---

此插件直接调用 OpenAI 兼容的 Chat Completions 接口生成图片

请在插件设置中填写：

- API 服务器地址（baseUrl）
- 使用的模型（model）
- API 密钥（apiKey）

---
此项目所需的koishi服务： 'http', 'logger', 'i18n'

---
`;

const logger = new Logger(name)

interface CommandConfig {
  basename: string
  nested: {
    commands: {
      name: string
      prompt: string
      enabled: boolean
      custom: boolean
      maxImages: number
      waitTimeout: number
      defaultImageUrls: string[]
    }[]
  }
  defaultWaitTimeout: number
  baseUrl: string
  model: string
  maxRetries: number
  retryInterval: number
  apiKey?: string
  loggerinfo: boolean
}

const defaultCommands = [
  {
    name: '手办化',
    prompt: 'Your task is to create a photorealistic, masterpiece-quality image of a 1/7 scale commercialized figurine based on the user\'s character. The final image must be in a realistic style and environment.\n\n**Crucial Instruction on Face & Likeness:** The figurine\'s face is the most critical element. It must be a perfect, high-fidelity 3D translation of the character from the source image. The sculpt must be sharp, clean, and intricately detailed, accurately capturing the original artwork\'s facial structure, eye style, expression, and hair. The final result must be immediately recognizable as the same character, elevated to a premium physical product standard. Do NOT generate a generic or abstract face.\n\n**Scene Composition (Strictly follow these details):**\n1. **Figurine & Base:** Place the figure on a computer desk. It must stand on a simple, circular, transparent acrylic base WITHOUT any text or markings.\n2. **Computer Monitor:** In the background, a computer monitor must display 3D modeling software (like ZBrush or Blender) with the digital sculpt of the very same figurine visible on the screen.\n3. **Artwork Display:** Next to the computer screen, include a transparent acrylic board with a wooden base. This board holds a print of the original 2D artwork that the figurine is based on.\n4. **Environment:** The overall setting is a desk, with elements like a keyboard to enhance realism. The lighting should be natural and well-lit, as if in a room.',
    enabled: true,
    custom: false,
    maxImages: 1,
    waitTimeout: 50,
    defaultImageUrls: []
  },
  {
    name: '手办化2',
    prompt: 'Use the nano-banana model to create a 1/7 scale commercialized figure of thecharacter in the illustration, in a realistic styie and environment.Place the figure on a computer desk, using a circular transparent acrylic basewithout any text.On the computer screen, display the ZBrush modeling process of the figure.Next to the computer screen, place a BANDAl-style toy packaging box printedwith the original artwork.',
    enabled: true,
    custom: false,
    maxImages: 1,
    waitTimeout: 50,
    defaultImageUrls: []
  },
  {
    name: '手办化3',
    prompt: 'Your primary mission is to accurately convert the subject from the user\'s photo into a photorealistic, masterpiece quality, 1/7 scale PVC figurine, presented in its commercial packaging.\n\n**Crucial First Step: Analyze the image to identify the subject\'s key attributes (e.g., human male, human female, animal, specific creature) and defining features (hair style, clothing, expression). The generated figurine must strictly adhere to these identified attributes.** This is a mandatory instruction to avoid generating a generic female figure.\n\n**Top Priority - Character Likeness:** The figurine\'s face MUST maintain a strong likeness to the original character. Your task is to translate the 2D facial features into a 3D sculpt, preserving the identity, expression, and core characteristics. If the source is blurry, interpret the features to create a sharp, well-defined version that is clearly recognizable as the same character.\n\n**Scene Details:**\n1. **Figurine:** The figure version of the photo I gave you, with a clear representation of PVC material, placed on a round plastic base.\n2. **Packaging:** Behind the figure, there should be a partially transparent plastic and paper box, with the character from the photo printed on it.\n3. **Environment:** The entire scene should be in an indoor setting with good lighting.',
    enabled: true,
    custom: false,
    maxImages: 1,
    waitTimeout: 50,
    defaultImageUrls: []
  },
  {
    name: 'coser化',
    prompt: 'Create a realistic cosplay photograph of the character in the image. The cosplayer should be wearing a high-quality costume that accurately replicates the character\'s outfit. Include appropriate props and background setting that matches the character\'s universe. Focus on accurate representation of costume details and realistic materials. Draw the picture for me with the background of a comic convention. East-asian face.',
    enabled: true,
    custom: false,
    maxImages: 1,
    waitTimeout: 50,
    defaultImageUrls: []
  },
  {
    name: 'mc化',
    prompt: 'Transform the image into a Minecraft-style character. Create a blocky, pixelated version of the character using Minecraft\'s visual style. Include appropriate Minecraft environment and elements in the background. The generated entities must be Minecraft-style entities or blocks/structures.',
    enabled: true,
    custom: false,
    maxImages: 1,
    waitTimeout: 50,
    defaultImageUrls: []
  },
  {
    name: '线稿化',
    prompt: '手绘线稿，精细的铅笔素描风格，纸上绘画效果，清晰的线条勾勒，适度的细节刻画。画面中包含绘画工具（如铅笔、橡皮、卷笔刀、素描本）自然散落在旁，呈现创作中的氛围。线条黑白灰调性，无色彩，突出纸张纹理和手绘质感，专注于形体结构和轮廓表现',
    enabled: true,
    custom: false,
    maxImages: 1,
    waitTimeout: 50,
    defaultImageUrls: []
  },
  {
    name: '爱上我了',
    prompt: 'Create a three-panel comic. The top third of the image is divided into two halves: the left half is the first panel, and the right half is the second panel. The bottom two-thirds of the image is the third panel. The character s appearance and clothing must match the reference image exactly. The first panel is a close-up of the character s face, with wide-open eyes showing a hint of surprise. Her mouth is gently covered by one hand, and there is an exclamation mark “!” beside her. The overall expression conveys surprise and slight shyness, with a one-hand-over-mouth gesture giving a coquettish pose. The second panel is also a close-up of the character’s face. Her eyes are squinting in a smiling expression, her mouth slightly open, and the hand covering her mouth is still in place. There is a sound effect “Pft~” indicating suppressed laughter. The expression is happy and playful, as if she can’t help but laugh. The gesture continues the hand-over-mouth pose but adds a lively, playful emotion. The third panel has a sky background with clouds, showing only the upper half of the character. The art style matches the reference image exactly. Her hair is being lifted by the wind, eyes curved in a gentle smile, with a soft blush on her cheeks. Her posture is relaxed, body slightly leaning forward, with both hands behind her back. The overall expression is confident and gentle, presenting a gracious and charming demeanor. On the left of the third panel is a circular dialogue bubble that says, “Do you think I’m beautiful?” On the lower right is another circular dialogue bubble that says, “That’s because you’ve already fallen in love with me, dummy.”',
    enabled: true,
    custom: true,
    maxImages: 1,
    waitTimeout: 60,
    defaultImageUrls: []
  },
  {
    name: '合并图片',
    prompt: '将两张图片合并为一张',
    enabled: true,
    custom: true,
    maxImages: 2,
    waitTimeout: 60,
    defaultImageUrls: []
  },
  {
    name: '修图',
    prompt: '修复图片中的缺陷',
    enabled: true,
    custom: true,
    maxImages: 1,
    waitTimeout: 60,
    defaultImageUrls: []
  },
  {
    name: '手办化4',
    prompt: 'Please accurately transform the subject in this photo into a realistic, masterpiece-worthy 1/7 scale PVC figurine. This figurine must possess 3D dimensionality, and the PVC texture must be clearly represented. The figurine is placed in a figurine display cabinet made of multi-layered glass; appropriate space should be left between the top of the figurine and the upper shelf, and the figurine must be paired with a transparent base. The indoor scene must be visible through the glass. Different figurines can be placed on other shelves, but they should exhibit a natural depth of field and blurred effect to further enhance the sense of spatial depth and highlight the main figurine. The scene requires a bright main light source, and the display cabinet should be embedded with dim LED strip lights; the overall light and reflections must blend naturally with the scene. The frame angle does not need to be fixed in a specific orientation.\nDetail Specifications: Every part of the figurine must be 3D dimensional, and flat or two-dimensional effects are prohibited; under no circumstances shall contour lines or outlines appear; when repairing missing parts of the figurine, no low-quality content shall appear; if repairing a human figure, it is necessary to ensure normal limb shape, coordinated movements, and reasonable proportions of all parts; if the original photo is not a full-body shot, try to supplement the figurine into a full-body form as much as possible; the expression, movements, and angle of the human figurine must be completely consistent with the original photo, but it must be 3D dimensional; the head of the human figurine must not be too large, the legs must not be too short, and the overall figure must not look short; for chibi cartoon subjects, their original proportions shall be retained, but they must be 3D dimensional; if the subject is an animal, its fur should be simplified to make it more like a figurine product; attention must be paid to following the perspective principle of objects appearing larger when closer and smaller when farther away.',
    enabled: true,
    custom: false,
    maxImages: 1,
    waitTimeout: 50,
    defaultImageUrls: []
  },
  {
    name: '手办化5',
    prompt: 'Realistic PVC figure based on the game screenshot character, exact pose replication highly detailed textures PVC material with subtle sheen and smooth paint finish, placed on an indoor wooden computer desk (with subtle desk items like a figure box/mouse), illuminated by soft indoor light (mix of desk lamp and natural window light) for realistic shadows and highlights, macro photography style,high resolution,sharp focus on the figure,shallow depth of field (desk background slightly blurred but visible), no stylization,true-to-reference color and design, 1:1scale.',
    enabled: true,
    custom: false,
    maxImages: 1,
    waitTimeout: 50,
    defaultImageUrls: []
  },
  {
    name: '手办化6',
    prompt: 'Create a premium, collectible 1/7 scale standalone figurine based on the image, meticulously replicating the character, made from smooth PVC and ABS plastic with a professional matte finish. It stands on a minimalist transparent acrylic base. Next to it is its retail packaging box displaying the price and brand information, with the figure wrapped in plastic inside the slightly larger box. They are naturally arranged on a clean wooden table surrounded by reference books, with a bookshelf in the background and soft afternoon sunlight streaming through the window. Photo-realistic, DSLR effect, depth of field, bokeh background.',
    enabled: true,
    custom: false,
    maxImages: 1,
    waitTimeout: 50,
    defaultImageUrls: []
  },
  {
    name: 'Q版化',
    prompt: '((chibi style)), ((super-deformed)), ((head-to-body ratio 1:2)), ((huge head, tiny body)), ((smooth rounded limbs)), ((soft balloon-like hands and feet)), ((plump cheeks)), ((childlike big eyes)), ((simplified facial features)), ((smooth matte skin, no pores)), ((soft pastel color palette)), ((gentle ambient lighting, natural shadows)), ((same facial expression, same pose, same background scene)), ((seamless integration with original environment, correct perspective and scale)), ((no outline or thin soft outline)), ((high resolution, sharp focus, 8k, ultra-detailed)), avoid: realistic proportions, long limbs, sharp edges, harsh lighting, wrinkles, blemishes, thick black outlines, low resolution, blurry, extra limbs, distorted face',
    enabled: true,
    custom: false,
    maxImages: 1,
    waitTimeout: 50,
    defaultImageUrls: []
  },
  {
    name: 'cos化',
    prompt: 'Generate a highly detailed photo of a real-life girl cosplaying this illustration, at Comiket. Exactly replicate the same pose, body posture, hand gestures, facial expression, and camera framing as in the original illustration. Keep the same angle, perspective, and composition, without any deviation.',
    enabled: true,
    custom: false,
    maxImages: 1,
    waitTimeout: 50,
    defaultImageUrls: []
  },
  {
    name: 'cos自拍',
    prompt: 'Generate a first-person perspective (POV) snapshot of a cosplayer in a cluttered bedroom. The cosplayer\'s hairstyle and anime costume must exactly match the subject in the reference image. She holds a phone in front of her face with both hands, completely covering her face. The phone screen is the focal point of the image, displaying the uploaded picture. The background is a room filled with posters on the walls and a slightly messy bed. The image should have a casual, informal snapshot quality with a slightly low-resolution and grainy texture, lit by natural indoor lighting.',
    enabled: true,
    custom: false,
    maxImages: 1,
    waitTimeout: 50,
    defaultImageUrls: []
  },
  {
    name: '痛屋化',
    prompt: '[ABSOLUTE PRIORITY AND NON-NEGOTIABLE DIRECTIVE] Based on the provided reference image, generate a hyper-detailed photograph of a maximalist otaku shrine with a strict, uncompromising requirement: all character-related elements—including figures, posters, bedding patterns, and the PC wallpaper—must be a 90%+ faithful, pixel-perfect replication of the character in the reference image. Strictly maintain the precise facial features, hairstyle, outfit, and expression with zero artistic reinterpretation or stylistic variation. With this core rule, create the scene at a 16:9 aspect ratio. The room is densely packed from floor to ceiling with merchandise that is an exact reproduction of this source character. The entire space is bathed in a moody, immersive ambient glow dominated by the reference character\'s primary color scheme (e.g., deep purple), which is sharply contrasted by a focused, brighter white light from a monitor screen bar lamp, creating dramatic visual layers. The walls are a collage made of posters and prints that are direct, unaltered copies of the reference image itself; the glass cabinets are cluttered with high-poly figures that are perfect 1:1 replicas of the reference character model; and the ultrawide monitor clearly displays the original reference image as its wallpaper. The final image must be a photorealistic, lived-in sanctuary, defined by its obsessive and flawless fidelity to the source character.',
    enabled: true,
    custom: false,
    maxImages: 1,
    waitTimeout: 50,
    defaultImageUrls: []
  },
  {
    name: '痛屋化2',
    prompt: 'Transform the uploaded indoor photo into a Japanese-style ita-room with the following specific requirements: Walls: Generate multi-size posters/scrolls (A2/A3/banner mixed arrangement) in an orderly matrix; no watermarks or garbled text. Curtains and bedding: Fully replace with themed patterns while retaining fabric folds and textures; pillowcases and life-sized cushions use the same character design. Display: Add glass display cabinets and open shelves, densely displaying themed figurines, acrylic stands, badge boards, and boxed peripherals of the same theme; arrange them in groups by height and color system. Desk: Keep the original equipment and light and shadow, only replace the screensaver/wallpaper with themed images; organize the wires neatly. Lighting: Add soft RGB light strips (along the ceiling and desk edges), coordinated with the main color, avoiding overexposure and color overflow. Texture: Realistic materials for PVC figurines, spray-painted paper, acrylic, and cotton fabrics; natural glass reflections without ghosting. Consistency: The face, hair color, and clothing details of the character on all carriers (posters/cushions/stands/box art) must maintain the same character and art style. Constraints (negative): No brand logos, watermarks, typos, distorted faces, perspective errors, repeated textures, over-sharpening, or noise.',
    enabled: true,
    custom: false,
    maxImages: 1,
    waitTimeout: 50,
    defaultImageUrls: []
  },
  {
    name: '痛车化',
    prompt: 'A Xiaomi SU7 electric sedan with a professional \'itasha\' wrap, parked on a rain-slicked, neon-lit city street at dusk. Accurately depict the Xiaomi SU7 body shape, grille-less front fascia, slim headlights, taillights, wheel design, and logo placements. The entire car is covered in a vibrant, high-resolution decal featuring multiple dynamic poses and expressions of ONLY the provided anime character. The glossy finish reflects colorful city lights, making the character artwork pop.Seamless full-body wrap integrating hood, doors, and rear quarter panels. Dynamic three-quarter front view showcasing the hood and side artwork.',
    enabled: true,
    custom: false,
    maxImages: 1,
    waitTimeout: 50,
    defaultImageUrls: []
  },
  {
    name: '孤独的我',
    prompt: 'Generate a hyper-realistic photograph with RAW photo quality, captured by a top-tier camera. The image must exhibit realistic skin textures, rich lighting layers, and a natural depth of field. Absolutely no anime, cartoon, CG, or painted elements are allowed—the result must be a 100% authentic photographic representation. The scene is set in a restaurant, captured from a first-person perspective. I am sitting alone, holding chopsticks in one hand and a phone in the other, displaying a photo of a beautiful cosplayer. In the background, the same cosplayer (dressed as the anime character) is dining with her boyfriend, feeding him a bite of food. The composition should evoke a sense of loneliness and contrast between the observer and the observed.',
    enabled: true,
    custom: false,
    maxImages: 1,
    waitTimeout: 50,
    defaultImageUrls: []
  },
  {
    name: '第一视角',
    prompt: 'At the venue of Japan\'s Comic Market Doujinshi Sales Event commonly known as Comiket a real Chinese boy or girl of the same gender as the character in the original image is sitting directly opposite you wearing a costume consistent with the one in the original image. A double meal set including hamburgers and French fries is placed on your table with crumpled tissues and some food scraps scattered beside it creating a strong sense of realism. Your Android phone is casually laid on the table and its screen displays an unedited original image of the character. The person is engaging in intimate interaction with you gazing gently into your eyes leaning slightly towards you and placing one hand softly on your arm.You are holding a hamburger or a few French fries.',
    enabled: true,
    custom: false,
    maxImages: 1,
    waitTimeout: 50,
    defaultImageUrls: []
  },
  {
    name: '第三视角',
    prompt: 'A scene in a bright, modern McDonald’s or KFC restaurant at night, consistent with the visual style of the provided original image (no AI-generated imagery). In front of you (the viewer), there are foods like a hamburger and a small serving of French fries (with a visibly small portion) on the table, along with a crumpled used tissue, a few food crumbs (adding a sense of realism), and an Android phone (with a character displayed on the screen)—you are holding a hamburger or a French fry in your hand. At a very nearby separate table (not a shared table)—so close that it’s within easy sight—two Chinese people are sitting and engaging in intimate interactions (e.g., gentle eye contact, leaning slightly towards each other, or one resting a hand lightly on the other’s arm). One of them is a coser dressed exactly as the character on your Android phone, with the coser’s gender strictly corresponding to the character’s gender (male coser remains male, female coser remains female, no gender reversal) and matching that of the character in the provided original image; the other is a man. On their table, there is a two-person set meal, and both figures are slightly blurred (not overly so). The overall atmosphere blends a relaxed dining vibe with character-related elements, featuring natural lighting, and adheres to the visual style of the original image.',
    enabled: true,
    custom: false,
    maxImages: 1,
    waitTimeout: 50,
    defaultImageUrls: []
  },
  {
    name: '鬼图',
    prompt: 'Convert the Input Image into a Convincing, Found-Footage Style Cryptid Sighting Photograph 1. The image should depict a [insert creature name or description - e.g., slender, pale humanoid; multi-limbed, insect-like entity; shadowy, canine-like beast], and the creature’s appearance must be highly similar to that in the original image. The creature should be spotted in a hyperrealistic and eerily desolate location, such as [e.g., an abandoned industrial complex at night, a remote, snow-covered mountain pass, the murky depths of a forgotten urban canal, a desolate rural road in the dead of winter]. 2. The shot must appear accidental, amateurish, and raw, as if captured spontaneously by a low-fidelity device like a [e.g., degraded VHS camcorder, grainy security camera, old disposable camera with flash, an infrared trail cam that\'s seen better days]. 3. To maximize the unsettling authenticity, the image quality should be significantly imperfect: featuring extreme [e.g., heavy digital noise, pronounced film grain, severe motion blur making details indistinct, a strong, disorienting lens flare, being significantly out of focus, or displaying visible static and tracking lines]. The creature should be partially obscured and difficult to clearly discern, perhaps hidden by [e.g., dense, skeletal tree branches; thick, unnatural fog; distorted reflections on murky water; the jagged silhouette of derelict machinery; or existing within deep, oppressive shadows]. 4. The lighting is critically dim and unsettling, possibly at [e.g., the darkest hour before dawn, a moonless midnight, or starkly illuminated by a harsh, direct, and slightly malfunctioning camera flash that overexposes parts of the scene].5. The overall feeling should evoke profound unease, dread, and a sense of witnessing something truly inexplicable and horrifying. Emphasize an atmosphere of isolation, decay, and the uncanny. 6. Keywords: cryptozoology, urban legend, paranormal, faked sighting, unsettling, horror, cryptid, grotesque, eerie, found footage, degraded quality, creature feature.',
    enabled: true,
    custom: false,
    maxImages: 1,
    waitTimeout: 50,
    defaultImageUrls: []
  },
  {
    name: '贴纸化',
    prompt: 'Generate A creative collage artwork based on the provided input image. The artwork should be created using a variety of materials such as paper, fabric, and found objects to achieve a textured, layered look. The composition should capture the essence of the original subject while incorporating collage techniques such as cutting, layering, and mixed media. The final piece should have a dynamic',
    enabled: true,
    custom: false,
    maxImages: 1,
    waitTimeout: 50,
    defaultImageUrls: []
  },
  {
    name: '玉足',
    prompt: 'Use the attached image as the exact protagonist (identity lock), maintaining exact facial features, hairstyle, and distinctive characteristics from the reference image. 1/7 scale commercial figurine, nano-banana model, hyper-detailed PVC figure. A character sitting on the ground with body positioned on the left side of the frame. From the character\'s perspective: RIGHT LEG fully extended straight forward, while LEFT LEG bent at the knee with foot flat on the ground. From viewer\'s perspective: The extended RIGHT LEG of the character appears on the LEFT SIDE of the frame, creating strong forced perspective with LOW ANGLE SHOT (foot size 2x larger than head). The character\'s extended right foot (viewer\'s left side) must be in sharp focus with soft milky-white skin tone, subtle pink undertones, and sole facing viewer at 45°, showing exactly 5 distinct toes with natural nail beds and delicate skin texture. Smooth, soft skin with a healthy, supple appearance. Arms crossed on chest, realistic hand-painted details, translucent PVC material effect. No background elements - focus entirely on the figurine\'s pose and foot details.',
    enabled: true,
    custom: false,
    maxImages: 1,
    waitTimeout: 50,
    defaultImageUrls: []
  },
  {
    name: '玩偶化',
    prompt: 'Reshape the character in the picture into a top-tier collectible *fumo*, with a fully soft and dynamic pose, and place it on the character theme fur pad. High-precision material, hand-stitched, the texture of the plush fabric and the clothing is truly distinct.\nIts eyes are the signature large embroidered semi-oval ones, without pupils, presenting a flat, sleepy or listless expression.\nThe main light source is soft diffused light, highlighting the fluffy feeling and soft texture, without overexposure. Powerful fill light eliminates dead black, and details are fully visible. The background is a blurred depth of field by the window, and the product packaging box is faintly visible on the side and rear. The sticker on the packaging box should be the original uploaded image.\nMuseum-level photography quality, every detail of the body is intact, and the embroidered facial features are exquisite and accurate.\nProhibited: Any 2D elements or direct copying of the original image, plastic feel, hard texture, blurred face, misaligned facial features, and loss of details.',
    enabled: true,
    custom: false,
    maxImages: 1,
    waitTimeout: 50,
    defaultImageUrls: []
  },
  {
    name: 'cos相遇',
    prompt: 'A lively comic convention scene with a bustling real-world environment, featuring the original manga-style character from the input image, retaining her exact colorful design, unique art style, and distinct features (including her specific hair color, outfit, and expression). The character remains a vibrant, non-realistic manga-style figure, not a 2D flat plane but preserving her original artistic depth and color palette. She stands in a crowded convention hall with colorful cosplay booths and attendees. Facing her is a cosplayer dressed in an identical outfit, mimicking her pose, both positioned at a 45-degree angle toward the viewer. The background is a detailed, realistic comic convention with vivid colors, dynamic crowd, and cosplay elements, creating a surreal blend of the manga character’s vibrant, non-realistic style with a real-world setting. Emphasize the magical encounter between the manga character and her cosplayer counterpart.',
    enabled: true,
    custom: false,
    maxImages: 1,
    waitTimeout: 50,
    defaultImageUrls: []
  },
  {
    name: '三视图',
    prompt: 'a 3-view orthographic drawing of a young woman from a photo, showing front, right side, and back views. Realistic rendering, professional character sheet style, on a white background',
    enabled: true,
    custom: false,
    maxImages: 1,
    waitTimeout: 50,
    defaultImageUrls: []
  },
  {
    name: '穿搭拆解',
    prompt: 'A professional e-commerce fashion showcase featuring the clothing worn by the character from the input image, presented in a clean, studio-style setting. The outfit is decomposed into individual pieces (e.g., top, bottom, jacket, shoes, accessories), each clearly displayed and arranged in an organized, visually appealing layout. Each clothing item retains the exact design, color, texture, and details from the original image, showcased with crisp lighting and high-definition clarity. The background is minimalistic, white or neutral, to emphasize the clothing details, suitable for an online retail platform. The presentation includes subtle annotations or labels for each item, ensuring a polished, catalog-style look for wear and styling inspiration.',
    enabled: true,
    custom: false,
    maxImages: 1,
    waitTimeout: 50,
    defaultImageUrls: []
  },
  {
    name: '拆解图',
    prompt: 'Convert the people in the photos to the style of a model kit box, rendered in isometric perspective. Label the box with the title“Zhogue”. Inside the box, a gouda-styled robotic version of the person in the photo is displayed, along with its essentials (such as cosmetics, bags, or other items) redesigned as a futuristic mechanical accessory. The box should resemble a real Gunpla box, with technical illustrations, manual-style details, and sci-fi fonts. Next to the box, the actual gouda-style robot itself is also displayed, rendered in a realistic and lifelike style on the outside of the packaging, similar to the official Bandai propaganda renderings.',
    enabled: true,
    custom: false,
    maxImages: 1,
    waitTimeout: 50,
    defaultImageUrls: []
  },
  {
    name: '角色界面',
    prompt: 'Transform the input person image into a game character selection interface. Display the character on the right side as a full-body portrait, standing upright at a 45-degree angle facing both the screen and the left-side selection module, mimicking a selected state in a video game. Retain the person image\'s facial features, expression, and hairstyle, but adapt the clothing to a game-inspired style (e.g., fantasy armor, sci-fi suit, or RPG adventurer outfit) with intricate details, vibrant textures, and thematic accessories, while preserving the original clothing\'s color scheme and general aesthetic. If the input is a half-body image, seamlessly complete the lower body, matching the game-style clothing and proportions. On the left side, present a sleek interface with selectable options including game-style clothing variations (e.g., different armor sets, robes, tactical gear), martial stats (e.g., strength, agility), equipment (e.g., swords, gadgets, shields), and health points, styled as interactive game UI elements with clear labels and modern design. Arrange the layout to mimic a video game character selection screen, with a smooth, unified background gradient (e.g., dark blue to soft gray) for a cohesive, natural transition across the image. Use consistent, cinematic lighting and subtle glow effects to enhance the game-like atmosphere while maintaining the character\'s real-world facial essence.',
    enabled: true,
    custom: false,
    maxImages: 1,
    waitTimeout: 50,
    defaultImageUrls: []
  },
  {
    name: '角色设定',
    prompt: '为我生成人物的角色设定（Character Design）,比例设定（不同身高对比、头身比等）,三视图（正面、侧面、背面）,表情设定（Expression Sheet） → 就是你发的那种图,动作设定（Pose Sheet） → 各种常见姿势,服装设定（Costume Design）',
    enabled: true,
    custom: false,
    maxImages: 1,
    waitTimeout: 50,
    defaultImageUrls: []
  },
  {
    name: '3D打印',
    prompt: 'Please transform the object in the uploaded image into a collectible figurine.Behind it, place a figurine box printed with the object\'s image and its name. Next to it, add a high-end 3D printer that is currently printing the figurine. In front of the figurine box, add a round plastic base for the figurine to stand on.The PVC material of the base should have a crystal-clear, translucent texture, and set the entire scene indoors.',
    enabled: true,
    custom: false,
    maxImages: 1,
    waitTimeout: 50,
    defaultImageUrls: []
  },
  {
    name: '微型化',
    prompt: 'A high-resolution advertising photograph of a realistic, miniature [PRODUCT] held delicately between a person\'s thumb and index finger. clean and white background, studio lighting, soft shadows. The hand is well-groomed, natural skin tone, and positioned to highlight the product\'s shape and details. The product appears extremely small but hyper-detailed and brand-accurate, centered in the frame with a shallow depth of field. Emulates luxury product photography and minimalist commercial style.',
    enabled: true,
    custom: false,
    maxImages: 1,
    waitTimeout: 50,
    defaultImageUrls: []
  },
  {
    name: '挂件化',
    prompt: 'Turn this photo into a cute charm / a flat acrylic keychain / a flat rubber keychain to hang on an LV bag / the bag in photo 2.',
    enabled: true,
    custom: false,
    maxImages: 1,
    waitTimeout: 50,
    defaultImageUrls: []
  },
  {
    name: '姿势表',
    prompt: '请为这幅插图创建一个姿势表，摆出各种姿势',
    enabled: true,
    custom: false,
    maxImages: 1,
    waitTimeout: 50,
    defaultImageUrls: []
  },
  {
    name: '高清修复',
    prompt: 'Enhance this image to high resolution',
    enabled: true,
    custom: false,
    maxImages: 1,
    waitTimeout: 50,
    defaultImageUrls: []
  },
  {
    name: '人物转身',
    prompt: 'show me this scene from behind the subjects. keep the details and the lighting identical',
    enabled: true,
    custom: false,
    maxImages: 1,
    waitTimeout: 50,
    defaultImageUrls: []
  },
  {
    name: '绘画四宫格',
    prompt: 'Step 1: line drawing. Step 2: tile colors. Step 3: Add Shadows. Step 4: Refine and shape. No words',
    enabled: true,
    custom: false,
    maxImages: 1,
    waitTimeout: 50,
    defaultImageUrls: []
  },
  {
    name: '发型九宫格',
    prompt: 'A professional hairstyle showcase based on the input image of a person\'s upper body and face, displaying the character with nine distinct hairstyles arranged in a clean, grid-like layout (3x3 grid) on a single image. Each hairstyle replaces the original hair while preserving the person\'s facial features, skin tone, and clothing details from the input image. The hairstyles include a variety of styles: short pixie cut, long wavy hair, sleek bob, voluminous curls, high ponytail, messy bun, side-swept bangs, braided updo, and straight layered cut, each rendered with realistic textures and natural lighting. The background is a consistent, neutral color (pure white or light gray) to emphasize the hairstyles and maintain a polished, professional look suitable for hairstyle selection. Subtle labels beneath each hairstyle indicate the style name for clarity.',
    enabled: true,
    custom: false,
    maxImages: 1,
    waitTimeout: 50,
    defaultImageUrls: []
  },
  {
    name: '头像九宫格',
    prompt: 'Id photos of the person in the picture with 9 different hairstyles, showing close-ups of the person with each hairstyle (Japanese, Korean, n) , keeping the features and clothes, and integration of the output for a nine grid picture',
    enabled: true,
    custom: false,
    maxImages: 1,
    waitTimeout: 50,
    defaultImageUrls: []
  },
  {
    name: '表情九宫格',
    prompt: 'Transform the input person image (half-body portrait) into a 3x3 grid of nine distinct images, each showcasing a different facial expression with the corresponding text label below the face, while retaining the original character\'s facial features, hairstyle, and clothing details. Arrange the expressions as follows: top row (happy with raised corners and squinted eyes labeled \'Happy\', sad with downturned mouth and raised inner brows labeled \'Sad\', angry with furrowed brows and narrowed eyes labeled \'Angry\'); middle row (surprised with wide eyes and open mouth labeled \'Surprised\', fearful with wide eyes and tense brows labeled \'Fearful\', disgusted with wrinkled nose and pursed lips labeled \'Disgusted\'); bottom row (confused with uneven brows and asymmetrical mouth labeled \'Confused\', proud with lifted chin and firm gaze labeled \'Proud\', embarrassed with tense smile and downward gaze labeled \'Embarrassed\'). Ensure each cell reflects the described expression naturally, with seamless completion of the lower body to match the original clothing style. Use a soft, unified background (e.g., light gray) and consistent lighting across all grids to maintain coherence and focus on the expressions.',
    enabled: true,
    custom: false,
    maxImages: 1,
    waitTimeout: 50,
    defaultImageUrls: []
  },
  {
    name: '多机位',
    prompt: '生成这张图片的正脸特写、侧身照、远景、背影的四种多机位镜头，然后整合输出到一张照片里，保持人物高度的一致性，适合生成连续剧情感镜头',
    enabled: true,
    custom: false,
    maxImages: 1,
    waitTimeout: 50,
    defaultImageUrls: []
  },
  {
    name: '电影分镜',
    prompt: '用这图里的角色创作一个令人上瘾的12部分故事，包含12张图像，讲述经典的黑色电影侦探故事。故事关于他们寻找线索并最终发现的失落的宝藏。整个故事充满刺激，有情感的高潮和低谷，以精彩的转折和高潮结尾。不要在图像中包含任何文字或文本，纯粹通过图像本身讲述故事',
    enabled: true,
    custom: false,
    maxImages: 1,
    waitTimeout: 50,
    defaultImageUrls: []
  },
  {
    name: '动漫分镜',
    prompt: 'According to the content of the picture to generate nine frames of comics, with pictures and lenses to tell a story.',
    enabled: true,
    custom: false,
    maxImages: 1,
    waitTimeout: 50,
    defaultImageUrls: []
  },
  {
    name: '真人化',
    prompt: 'in Studio, pure white background, a cosplayer dressed in an identical outfit, as the girl in the reference image, mimicking her pose and outfit. enhanced with film grain for a gritty, authentic particle effect reminiscent of 35mm film stock; 8K ultra-HD, sharp and believable, no abstraction.',
    enabled: true,
    custom: false,
    maxImages: 1,
    waitTimeout: 50,
    defaultImageUrls: []
  },
  {
    name: '真人化2',
    prompt: 'Generate a highly detailed photo of a girl cosplaying this illustration, at Comiket. Exactly replicate the same pose, body posture, hand gestures, facial expression, and camera framing as in the original illustration. Keep the same angle, perspective, and composition, without any deviation',
    enabled: true,
    custom: false,
    maxImages: 1,
    waitTimeout: 50,
    defaultImageUrls: []
  },
  {
    name: '半真人',
    prompt: 'Take the image of the woman in [Input Photo]. Apply a creative split-style effect. Keep the lower half of her body (legs and boots) as the original photograph. Transform the upper half of her body (torso, arms, head) into a vibrant, 2D anime style with bold outlines and flat colors, similar to the anime \'Cyberpunk: Edgerunners\'. The transition between the two styles should be a clean, slightly curved line.',
    enabled: true,
    custom: false,
    maxImages: 1,
    waitTimeout: 50,
    defaultImageUrls: []
  },
  {
    name: '半融合',
    prompt: 'A striking, high-definition frontal portrait of the character from the input photo, with the face perfectly centered. The image blends two styles seamlessly: the left half retains the character\'s original realistic appearance, including detailed skin textures, natural lighting, and exact facial features from the input image, while the right half transitions into a vibrant manga-style version, featuring bold outlines, expressive eyes, and stylized features typical of high-quality anime art, while preserving recognizable traits (e.g., hair shape, facial structure). The transition between the realistic and manga halves is smooth and gradual, with no visible dividing line, ensuring a natural, cohesive fusion at the center of the face. The blending emphasizes the contrast between realistic and manga aesthetics while maintaining a unified appearance. The background is a neutral, solid color (e.g., soft gray or white) to highlight the fusion effect, with consistent lighting to enhance the artistic impact and no harsh separation.',
    enabled: true,
    custom: false,
    maxImages: 1,
    waitTimeout: 50,
    defaultImageUrls: []
  }
]

export const Config: Schema = Schema.intersect([
  Schema.object({
    basename: Schema.string().default(name).description('父级指令名称'),
    nested: Schema.object({
      commands: Schema.array(
        Schema.object({
          name: Schema.string().required().description('指令名称'),
          prompt: Schema.string().role('textarea', { rows: [6, 4] }).description('该指令对应的提示词（自定义指令可留空）'),
          enabled: Schema.boolean().default(true).description('是否启用该指令'),
          custom: Schema.boolean().default(false).description('是否为自定义指令（允许用户输入提示词）'),
          maxImages: Schema.number().default(1).min(0).max(5).description('需要用户提供的最大图片数量（不包括默认图片）'),
          waitTimeout: Schema.number().default(30).max(120).min(10).step(1).description("等待输入图片的最大时间（秒）"),
          defaultImageUrls: Schema.array(Schema.string().role('link')).description('默认图片URL列表（不计入用户图片数量）').default([])
        })).description('指令配置').default(defaultCommands),
    }).collapse().description('指令配置项太长啦，这样折叠起来更方便哦~'),


    defaultWaitTimeout: Schema.number().default(50).max(120).min(10).step(1).description("默认等待输入图片的最大时间（秒）"),
  }).description('基础配置'),

  Schema.object({
    baseUrl: Schema.string().default('https://api.gptgod.online/v1/chat/completions').role('link').description('API 服务器地址（OpenAI 兼容 Chat Completions 接口）'),
    model: Schema.string().default('gemini-2.5-flash-image').description('使用的模型名称'),
    apiKey: Schema.string().role('secret').description('API 密钥'),
    maxRetries: Schema.number().default(3).description('最大重试次数'),
    retryInterval: Schema.number().default(1000).description('重试间隔(毫秒)'),
  }).description('API 设置'),

  Schema.object({
    loggerinfo: Schema.boolean().default(false).description("日志调试模式"),
  }).description('调试设置'),
])


export function apply(ctx: Context, config: CommandConfig) {
  let isActive = true

  ctx.on('dispose', () => {
    isActive = false
  })

  ctx.on('ready', () => {

    ctx.i18n.define("zh-CN", {
      [name]: {
        description: '将图片转换为特定风格',
        messages: {
          waitprompt: '请在{0}秒内发送一张图片...',
          waitpromptmultiple: '请在{0}秒内发送{1}张图片...',
          customprompt: '请在{0}秒内输入自定义提示词...',
          invalidimage: '未检测到有效的图片，请重新发送带图片的消息',
          processing: '正在处理图片，请稍候...',
          failed: '图片生成失败，请稍后重试',
          error: '处理过程中发生错误，请稍后重试',
          needprompt: '请提供自定义提示词',
          needimages: '请提供至少一张图片'
        },
      }
    })

    ctx.command(config.basename)

    for (const cmdConfig of config.nested.commands) {
      if (!cmdConfig.enabled) continue;

      ctx.command(`${config.basename}/${cmdConfig.name} [message:text]`)
        .usage(`使用 ${cmdConfig.name} 风格处理图片`)
        .action(async ({ session }, message) => {
          if (!isActive || !ctx.scope.isActive) {
            return
          }
          if (!session) return

          const quote = h.quote(session.messageId)
          const customCommand = cmdConfig.custom || false
          const maxImages = cmdConfig.maxImages || 0 // 用户需要提供的图片数量
          const waitTimeout = cmdConfig.waitTimeout || config.defaultWaitTimeout
          const defaultImageUrls = cmdConfig.defaultImageUrls || [] // 多个默认图片URL

          let promptText = cmdConfig.prompt
          let images: string[] = []

          // 添加所有默认图片
          if (defaultImageUrls.length > 0) {
            images.push(...defaultImageUrls)
            logInfo(`添加 ${defaultImageUrls.length} 张默认图片`)
          }

          // 自定义指令处理逻辑
          if (customCommand) {
            let textContent: string | undefined

            if (message) {
              const textElements = h.select(session.stripped.content, 'text')
              if (textElements.length > 0) {
                // 合并所有文本内容
                textContent = textElements.map(el => el.attrs.content || '').join(' ').trim()
              }
            }

            if (textContent) {
              // 合并系统提示词和用户输入
              promptText = cmdConfig.prompt ? `${cmdConfig.prompt}\n\n${textContent}` : textContent
            }

            // 如果没有提示词，要求用户输入
            if (!promptText) {
              const [msgId] = await session.send(session.text("image-prompt.messages.customprompt", [waitTimeout]))
              const userPrompt = await session.prompt(waitTimeout * 1000)

              try {
                await session.bot.deleteMessage(session.channelId, msgId)
              } catch {
                ctx.logger.warn(`在频道 ${session.channelId} 尝试撤回消息ID ${msgId} 失败。`)
              }

              if (userPrompt) {
                // 合并系统提示词和用户输入
                promptText = cmdConfig.prompt ? `${cmdConfig.prompt}\n\n${userPrompt}` : userPrompt
              } else {
                await session.send(`${quote}${session.text("image-prompt.messages.needprompt")}`)
                return
              }
            }
          }

          // 收集用户提供的图片（不包括默认图片）
          const extractedImages = extractImagesFromSession(session)
          images.push(...extractedImages)

          // 计算还需要用户提供的图片数量
          const remainingImages = Math.max(0, maxImages - extractedImages.length)

          // 如果还需要用户提供图片，等待用户发送
          if (remainingImages > 0) {
            const [msgId] = await session.send(
              session.text("image-prompt.messages.waitpromptmultiple", [waitTimeout, remainingImages])
            )

            try {
              for (let i = 0; i < remainingImages; i++) {
                const promptContent = await session.prompt(waitTimeout * 1000)
                if (promptContent !== undefined) {
                  const newImages = extractImagesFromMessage(promptContent)
                  images.push(...newImages)
                } else {
                  break
                }
              }
            } finally {
              try {
                await session.bot.deleteMessage(session.channelId, msgId)
              } catch {
                ctx.logger.warn(`在频道 ${session.channelId} 尝试撤回消息ID ${msgId} 失败。`)
              }
            }
          }

          // 检查是否有图片
          if (images.length === 0) {
            await session.send(`${quote}${session.text("image-prompt.messages.needimages")}`)
            return
          }

          logInfo(images)

          try {
            await session.send(quote + session.text('image-prompt.messages.processing'))

            // 下载所有图片
            const files = await Promise.all(
              images.map(src => ctx.http.file(src).catch(err => {
                ctx.logger.error(`下载图片失败: ${src}`, err)
                return null
              }))
            ).then(results => results.filter(Boolean))

            if (files.length === 0) {
              await session.send(`${quote}${session.text("image-prompt.messages.invalidimage")}`)
              return
            }

            const result = await generateFigureImage(files, promptText)

            if (result) {
              return h.image(result)
            } else {
              return session.text('image-prompt.messages.failed')
            }
          } catch (error) {
            ctx.logger.error(`[${cmdConfig.name}] 处理图片时发生错误:`, error)
            return session.text('image-prompt.messages.error')
          }
        })
    }

    function extractImagesFromSession(session: Session): string[] {
      const images: string[] = []

      // 从当前消息中提取
      const currentImages = extractImagesFromMessage(session.stripped.content)
      images.push(...currentImages)

      // 从引用消息中提取
      if (session.quote) {
        const quoteImages = extractImagesFromMessage(session.quote.content)
        images.push(...quoteImages)
      }

      return images
    }

    function extractImagesFromMessage(content: string): string[] {
      const images: string[] = []

      // 提取<img>标签中的图片
      const imgElements = h.select(content, 'img')
      for (const img of imgElements) {
        if (img.attrs.src) {
          images.push(img.attrs.src)
        }
      }

      // 提取<mface>标签中的图片
      const mfaceElements = h.select(content, 'mface')
      for (const mface of mfaceElements) {
        if (mface.attrs.url) {
          images.push(mface.attrs.url)
        }
      }

      return images
    }

    async function generateFigureImage(files: any[], prompt: string): Promise<string | null> {
      try {
        const dataUrls: string[] = []

        for (const file of files) {
          let processedImageData = file.data
          let originalMimeType = file.mime || 'image/jpeg'
          let finalMimeType = originalMimeType // 最终的MIME类型

          let base64Image: string
          if (Buffer.isBuffer(processedImageData)) {
            base64Image = processedImageData.toString('base64')
          } else if (processedImageData instanceof ArrayBuffer) {
            base64Image = Buffer.from(processedImageData).toString('base64')
          } else {
            base64Image = Buffer.from(processedImageData).toString('base64')
          }

          // 使用最终的MIME类型
          dataUrls.push(`data:${finalMimeType};base64,${base64Image}`)
        }

        // 请求体
        const contentArray: any[] = [
          {
            type: "text",
            text: prompt
          }
        ]

        // 添加所有图片
        for (const dataUrl of dataUrls) {
          contentArray.push({
            type: "image_url",
            image_url: {
              url: dataUrl
            }
          })
        }

        const requestBody = {
          model: config.model,
          messages: [
            {
              role: "user",
              content: contentArray
            }
          ],
          max_tokens: 300,
          n: 1
        }

        logInfo('请求体结构:', JSON.stringify({
          ...requestBody,
          messages: [
            {
              ...requestBody.messages[0],
              content: [
                requestBody.messages[0].content[0],
                ...requestBody.messages[0].content.slice(1).map((item: any, index: number) => {
                  const originalUrl = item.image_url.url
                  const mimeMatch = originalUrl.match(/^data:([^;]+);base64,/)
                  const mimeType = mimeMatch ? mimeMatch[1] : 'image'
                  return {
                    type: "image_url",
                    image_url: {
                      url: `data:${mimeType};base64,[${originalUrl.length} chars]`
                    }
                  }
                })
              ]
            }
          ]
        }, null, 2))

        // 直接请求 API（带鉴权头与重试）
        return await sendChatRequest(requestBody)
      } catch (error) {
        ctx.logger.error(`生成图片时发生错误: ${error}`)
        return null
      }
    }

    async function sendChatRequest(requestBody: any): Promise<string | null> {
      let retryCount = 0

      while (retryCount <= config.maxRetries) {
        // 在每次重试前检查上下文状态
        if (!isActive || !ctx.scope.isActive) {
          ctx.logger.info('插件已卸载，停止重试')
          return null
        }

        try {
          logInfo(`发送请求到 ${config.baseUrl}，第 ${retryCount + 1} 次尝试`)

          const headers: Record<string, string> = {
            'Content-Type': 'application/json'
          }
          if (config.apiKey) {
            headers['Authorization'] = `Bearer ${config.apiKey}`
          }

          const response = await ctx.http.post(config.baseUrl, requestBody, { headers })

          // 处理响应
          if (response && response.choices && response.choices[0] && response.choices[0].message) {
            const message = response.choices[0].message

            logInfo(`响应：${JSON.stringify(response)}`)
            if (message.content) {
              // 尝试匹配Markdown格式的图片链接
              const markdownMatch = message.content.match(/!\[.*?\]\((https?:\/\/[^)]+)\)/)
              if (markdownMatch && markdownMatch[1]) {
                const imageUrl = markdownMatch[1]
                logInfo(`成功获取图片URL: ${imageUrl}`)
                return imageUrl
              }
            }
          }

          const errorMsg = '响应中未找到图片URL'
          throw new Error(errorMsg)
        } catch (error) {
          retryCount++
          const errorMessage = error.message || error.toString()
          const statusCode = error.response?.status || 0

          logInfo(`请求失败 (${retryCount}/${config.maxRetries}): ${errorMessage}`)

          // 检查是否为配额不足错误
          if (errorMessage.includes('insufficient_quota') || statusCode === 429) {
            ctx.logger.error('API 配额不足，停止重试')
            return null
          }

          if (retryCount <= config.maxRetries) {
            logInfo(`等待 ${config.retryInterval}ms 后重试`)
            await sleep(config.retryInterval)
            if (!isActive || !ctx.scope.isActive) {
              ctx.logger.info('插件已卸载，停止重试')
              return null
            }
          } else {
            ctx.logger.error(`达到最大重试次数 (${config.maxRetries})，最后错误: ${errorMessage}`)
            return null
          }
        }
      }
      return null
    }

    function logInfo(...args: any[]) {
      if (config.loggerinfo) {
        (logger.info as (...args: any[]) => void)(...args);
      }
    }
  })
}
